import * as z from "zod";
import { buildOutgoing, draftFor, type ComposeDraft } from "~/lib/compose";
import { formatAddress, isEmail, parseAddressList } from "~/lib/mail";
import {
  attachmentInput,
  inlineAttachment,
  MAX_ATTACHMENTS_BYTES,
  mimeTypeOf,
  type AttachmentInput,
} from "~/mcp/attachments";
import { listAccounts, toSummary } from "./accounts.server";
import { forwardedAttachments, getAttachment, loadThread, requireAccount, sendMessage } from "./mail.server";
import type { OutgoingAttachment } from "./providers/types";
import { downloadFile } from "./remote-file.server";

/**
 * The emails that AI agents write and send: the input of the MCP tools, the
 * recipients, the quoted original, and the files. The MCP server and the
 * upload route of send_with_files (routes/api.agent-send.ts) share it.
 */

/** An account ID, or the email address of an account. Agents often give the address. */
export async function accountIdOf(userId: string, value: string) {
  if (!value.includes("@")) return value;
  const account = (await listAccounts(userId)).find((a) => a.email.toLowerCase() === value.trim().toLowerCase());
  if (!account) throw new Error(`The workspace has no account ${value}. Call list_accounts to get the accounts.`);
  return account.id;
}

export const accountId = z.string().describe("The account ID from list_accounts, or the email address of the account.");
export const threadId = z.string().describe("The thread ID from search_threads.");

export const messageInput = z.object({
  account_id: accountId.describe("The account that sends the email."),
  mode: z.enum(["new", "reply", "reply_all", "forward"]).default("new"),
  thread_id: z.string().optional().describe("Required for reply, reply_all, and forward."),
  message_id: z
    .string()
    .optional()
    .describe("The message to reply to or forward. The default is the last message of the thread."),
  to: z.array(z.string()).optional().describe('Addresses, for example "Ada <ada@example.com>".'),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string().describe("The message, in Markdown."),
  attachments: z
    .array(attachmentInput)
    .max(20)
    .optional()
    .describe(
      "Files to attach. Give each file as a public https url, as text, as a file of another email " +
        "(message_id and attachment_id from get_thread), or as content_base64 (only for a small file). " +
        "For a file on the local disk, use send_with_files. A forward already keeps the files of the original. " +
        "The limit is 25 MB in total.",
    ),
});

export const draftInput = messageInput.omit({ attachments: true }).extend({
  account_id: accountId.describe("The account that keeps the draft."),
  draft_id: z
    .string()
    .optional()
    .describe("To change a draft: the draft_id from save_draft or get_thread. Omit it to make a new draft."),
});

/** Finds the account, the quoted original, the recipients, and the subject of an email that an agent writes. */
export async function resolveDraft(
  userId: string,
  input: z.infer<typeof messageInput>,
  /** False for a draft: drafts do not keep files, so the server does not download them. */
  options: { files: boolean } = { files: true },
  /** Files that came with the request itself (send_with_files). They count toward the limit. */
  localFiles: OutgoingAttachment[] = [],
) {
  const account = await requireAccount(userId, await accountIdOf(userId, input.account_id));
  const list = (values?: string[]) => (values ? parseAddressList(values.join(",")) : undefined);

  let draft: ComposeDraft;
  if (input.mode === "new") {
    draft = { id: "", accountId: account.id, to: "", cc: "", bcc: "", subject: "", body: "" };
  } else {
    if (!input.thread_id) throw new Error("thread_id is required for this mode.");
    const thread = await loadThread(userId, account.id, input.thread_id);
    const message = input.message_id
      ? thread.messages.find((m) => m.id === input.message_id)
      : thread.messages.at(-1);
    if (!message) throw new Error("The thread has no message with this message_id.");
    draft = draftFor(input.mode === "reply_all" ? "replyAll" : input.mode, message, toSummary(account));
  }

  // Agents sometimes give a name for an address. The mail server would reject it with an unclear error.
  const given = [list(input.to), list(input.cc), list(input.bcc)];
  const invalid = given.flatMap((addresses) => addresses ?? []).find((address) => !isEmail(address.email));
  if (invalid) {
    throw new Error(
      `"${invalid.email}" is not a valid email address. Use find_contacts to find the address of a person.`,
    );
  }
  // The original email can have an address with no domain, such as an Exchange group. A reply leaves it out.
  const copied = (value: string) => parseAddressList(value).filter((address) => isEmail(address.email));
  const to = given[0] ?? copied(draft.to);
  const cc = given[1] ?? copied(draft.cc);
  const bcc = given[2] ?? [];

  // A forward sends the files of the original message again.
  const original =
    options.files && draft.forwarded
      ? await forwardedAttachments(userId, {
          accountId: draft.forwarded.accountId,
          messageId: draft.forwarded.messageId,
          attachmentIds: draft.forwarded.attachments.map((a) => a.id),
        })
      : [];
  const used = [...original, ...localFiles].reduce((sum, file) => sum + file.content.length, 0);
  if (used > MAX_ATTACHMENTS_BYTES) throw new Error("The attachments must be 25 MB or less in total.");
  const added = options.files
    ? await addedAttachments(userId, account.id, input.attachments ?? [], MAX_ATTACHMENTS_BYTES - used)
    : [];

  return { account, draft, original, added, to, cc, bcc, subject: input.subject ?? draft.subject };
}

/**
 * Gets the files that the agent attaches: its own content, files on the web,
 * or files of other emails in the workspace. The files load one at a time, so
 * a download stops at the bytes that are left of the limit.
 */
async function addedAttachments(userId: string, sendingAccountId: string, inputs: AttachmentInput[], budget: number) {
  const files: OutgoingAttachment[] = [];
  let left = budget;
  for (const input of inputs) {
    const file = await addedAttachment(userId, sendingAccountId, input, left);
    left -= file.content.length;
    if (left < 0) throw new Error("The attachments must be 25 MB or less in total.");
    files.push(file);
  }
  return files;
}

async function addedAttachment(
  userId: string,
  sendingAccountId: string,
  input: AttachmentInput,
  left: number,
): Promise<OutgoingAttachment> {
  checkSource(input);
  if (input.url !== undefined) {
    const file = await downloadFile(input.url, Math.max(left, 0));
    const filename = input.filename?.trim() || file.filename;
    // Many servers send application/octet-stream for all files, so the extension is better then.
    const served = file.contentType && file.contentType !== "application/octet-stream" ? file.contentType : "";
    return { filename, contentType: input.mime_type || served || mimeTypeOf(filename), content: file.content };
  }
  if (!input.message_id && !input.attachment_id) return inlineAttachment(input);
  if (!input.message_id || !input.attachment_id) {
    throw new Error("An attachment from another email needs both message_id and attachment_id.");
  }
  const accountId = input.account_id ? await accountIdOf(userId, input.account_id) : sendingAccountId;
  const file = await getAttachment(userId, accountId, input.message_id, input.attachment_id);
  return {
    filename: input.filename?.trim() || file.filename,
    contentType: input.mime_type || file.mimeType || "application/octet-stream",
    content: file.data,
  };
}

export type MessageInput = z.infer<typeof messageInput>;

function checkSource(input: AttachmentInput) {
  const sources = [
    input.content_base64 !== undefined,
    input.text !== undefined,
    input.url !== undefined,
    !!(input.message_id || input.attachment_id),
  ].filter(Boolean).length;
  if (sources > 1) {
    throw new Error("Give each attachment only one of content_base64, text, url, or message_id and attachment_id.");
  }
  if ((input.message_id || input.attachment_id) && !(input.message_id && input.attachment_id)) {
    throw new Error("An attachment from another email needs both message_id and attachment_id.");
  }
}

/**
 * Checks the attachments input and the size of the forwarded files, with no
 * download, so that send_with_files finds a mistake before the upload.
 */
export function checkAttachments(input: MessageInput, draft: ComposeDraft) {
  for (const attachment of input.attachments ?? []) {
    checkSource(attachment);
    if (attachment.url !== undefined) {
      let url: URL | undefined;
      try {
        url = new URL(attachment.url);
      } catch {
        // The error below.
      }
      if (url?.protocol !== "https:") throw new Error(`${attachment.url} is not an https URL.`);
    } else if (!attachment.message_id) {
      inlineAttachment(attachment);
    }
  }
  const forwarded = draft.forwarded?.attachments.reduce((sum, file) => sum + file.size, 0) ?? 0;
  if (forwarded > MAX_ATTACHMENTS_BYTES) {
    throw new Error("The files of the forwarded message are larger than 25 MB, so the email cannot go.");
  }
}

/**
 * Sends an email that an agent wrote. `localFiles` are the files of a
 * send_with_files upload, which the server has only in memory. Returns a
 * sentence for the agent.
 */
export async function sendAgentEmail(userId: string, input: MessageInput, localFiles: OutgoingAttachment[] = []) {
  const { account, draft, original, added, to, cc, bcc, subject } = await resolveDraft(
    userId,
    input,
    { files: true },
    localFiles,
  );
  if (to.length + cc.length + bcc.length === 0) throw new Error("Add at least one recipient.");
  const attachments = [...original, ...added, ...localFiles];
  await sendMessage(userId, account.id, {
    to,
    cc,
    bcc,
    subject,
    ...buildOutgoing({ ...draft, body: input.body }),
    attachments,
    reply: draft.reply,
  });
  const recipients = [...to, ...cc, ...bcc].map(formatAddress).join(", ");
  const files = attachments.length ? ` with ${attachments.length} attachment${attachments.length > 1 ? "s" : ""}` : "";
  return `Sent "${subject}" from ${account.email} to ${recipients}${files}.`;
}
