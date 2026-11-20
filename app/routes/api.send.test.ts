import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftFor } from "~/lib/compose";
import type { AccountSummary, RenderedMessage } from "~/lib/mail";

vi.mock("~/server/auth.server", () => ({
  requireUserId: vi.fn(async () => "user-1"),
}));
vi.mock("~/server/rate-limit.server", () => ({
  rateLimit: vi.fn(async () => true),
}));
vi.mock("~/server/mail.server", () => ({
  forwardedAttachments: vi.fn(),
  sendMessage: vi.fn(),
}));

const mail = vi.mocked(await import("~/server/mail.server"));
const { action } = await import("./api.send");

const account = {
  id: "acc-1",
  email: "me@example.com",
  name: "Me",
  color: "blue",
  provider: "imap",
  status: "active",
} as AccountSummary;
const message = {
  id: "msg-1",
  threadId: "thr-1",
  from: { email: "sender@example.com" },
  to: [{ email: "me@example.com" }],
  cc: [],
  bcc: [],
  replyTo: [],
  subject: "Invoice",
  date: "2026-11-01T10:00:00Z",
  snippet: "See the invoice",
  text: "See the invoice",
  unread: false,
  starred: false,
  hasQuote: false,
  attachments: [
    {
      id: "att-1",
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      size: 1200,
      inline: false,
    },
  ],
} as RenderedMessage;

function sendForm(fields: Record<string, string>, files: File[] = []) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  for (const file of files) form.append("attachments", file);
  const request = new Request("https://app.test/api/send", {
    method: "POST",
    body: form,
  });
  return action({ request } as Parameters<typeof action>[0]);
}

beforeEach(() => vi.clearAllMocks());

describe("forward", () => {
  it("keeps the files of the original message in the draft", () => {
    const draft = draftFor("forward", message, account);
    expect(draft.forwarded).toEqual({
      accountId: "acc-1",
      messageId: "msg-1",
      attachments: [
        {
          id: "att-1",
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          size: 1200,
        },
      ],
    });
    expect(draftFor("reply", message, account).forwarded).toBeUndefined();
  });

  it("sends the forwarded files with the uploaded files", async () => {
    const pdf = {
      filename: "invoice.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4"),
    };
    mail.forwardedAttachments.mockResolvedValue([pdf]);
    const forward = {
      accountId: "acc-1",
      messageId: "msg-1",
      attachmentIds: ["att-1"],
    };

    const response = await sendForm(
      {
        accountId: "acc-1",
        to: "friend@example.com",
        subject: "Fwd: Invoice",
        forward: JSON.stringify(forward),
      },
      [new File(["notes"], "notes.txt", { type: "text/plain" })],
    );

    expect(response.status).toBe(200);
    expect(mail.forwardedAttachments).toHaveBeenCalledWith("user-1", forward);
    const sent = mail.sendMessage.mock.calls[0][2];
    expect(sent.attachments.map((a) => a.filename)).toEqual(["invoice.pdf", "notes.txt"]);
  });

  it("refuses forwarded files that make the message too large", async () => {
    const big = {
      filename: "big.pdf",
      contentType: "application/pdf",
      content: Buffer.alloc(26 * 1024 * 1024),
    };
    mail.forwardedAttachments.mockResolvedValue([big]);
    const forward = {
      accountId: "acc-1",
      messageId: "msg-1",
      attachmentIds: ["att-1"],
    };

    const response = await sendForm({
      accountId: "acc-1",
      to: "friend@example.com",
      forward: JSON.stringify(forward),
    });

    expect(response.status).toBe(400);
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses forward data that is not valid", async () => {
    const response = await sendForm({
      accountId: "acc-1",
      to: "friend@example.com",
      forward: '{"messageId":1}',
    });
    expect(response.status).toBe(400);
    expect(mail.forwardedAttachments).not.toHaveBeenCalled();
  });
});
