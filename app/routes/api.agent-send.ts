import { createHash } from "node:crypto";
import { cleanFilename, mimeType, mimeTypeOf } from "~/mcp/attachments";
import { resolveUser } from "~/server/accounts.server";
import { consentAllows } from "~/server/agent-connections.server";
import { sendAgentEmail } from "~/server/agent-email.server";
import type { OutgoingAttachment } from "~/server/providers/types";
import { rateLimit, resetRateLimit } from "~/server/rate-limit.server";
import { openSendLink, SEND_LINK_TTL_MS, SendLinkError } from "~/server/send-link.server";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.agent-send";

// The upload URL of the send_with_files MCP tool. The agent sends files from
// its disk with curl -F file=@<path> "<url>". This request attaches them and
// sends the email that the URL carries. The files stay in memory only for this
// request: the server does not store them.

/** The attachments of one email, as in the mail app. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The files and the multipart encoding. */
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;

const json = (body: object, status = 200) => Response.json(body, { status });

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: 'Send the files with POST: curl -F "file=@<path>" "<url>".' }, 405);
  try {
    const link = openSendLink(new URL(request.url).searchParams.get("t") ?? "");
    // After the tool made the URL, the workspace can join another one, and the user can disconnect
    // the agent or connect it again without the send permission.
    const userId = await resolveUser(link.u);
    if (!userId || !(await consentAllows(link.u, link.c, "mail:send"))) {
      return json({ error: "The user disconnected this agent, or took away its send permission. Nothing was sent." }, 403);
    }
    if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
      return json({ error: "The files are larger than 25 MB. Nothing was sent." }, 413);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: 'Send the files as multipart: curl -F "file=@<path>" "<url>". Nothing was sent.' }, 400);
    }

    const body = await readLimited(request.body);
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } })
      .formData()
      .catch(() => null);
    if (!form) return json({ error: "The request is not valid multipart data. Nothing was sent." }, 400);
    const files: OutgoingAttachment[] = [];
    for (const value of form.values()) {
      if (typeof value === "string") continue;
      const filename = cleanFilename(value.name);
      // curl sends application/octet-stream for most files, and a part can give any text as its type.
      const given = value.type.split(";")[0].trim();
      const type = given !== "application/octet-stream" && mimeType.safeParse(given).success ? given : "";
      files.push({
        filename,
        contentType: type || mimeTypeOf(filename),
        content: Buffer.from(await value.arrayBuffer()),
      });
    }
    if (files.length === 0) {
      return json({ error: 'The request has no file. Use curl -F "file=@<path>" "<url>". Nothing was sent.' }, 400);
    }
    if (files.some((file) => file.content.length === 0)) {
      return json({ error: "A file is empty. Check the path. Nothing was sent." }, 400);
    }
    if (files.reduce((sum, file) => sum + file.content.length, 0) > MAX_FILE_BYTES) {
      return json({ error: "The files are larger than 25 MB. Nothing was sent." }, 413);
    }

    // The URL sends once. The server records only its random ID, until the URL expires.
    const once = `agent-send:${link.n}`;
    if (!(await rateLimit(once, 1, SEND_LINK_TTL_MS / 1000))) {
      return json(
        { error: "This upload URL sent its email already, or it sends it now. Do not send it again." },
        409,
      );
    }
    let sent: string;
    try {
      sent = await sendAgentEmail(userId, link.m, files);
    } catch (error) {
      // Nothing went, so the agent can run the same command again.
      await resetRateLimit(once).catch(() => {});
      return json({ error: `The email did not send: ${errorMessage(error)} Nothing was sent.` }, 502);
    }
    return json({
      sent: true,
      message: sent,
      files: files.map((file) => ({
        filename: file.filename,
        size: file.content.length,
        sha256: createHash("sha256").update(file.content).digest("hex"),
      })),
    });
  } catch (error) {
    if (error instanceof SendLinkError) return json({ error: error.message }, error.status);
    if (error instanceof TooLarge) return json({ error: "The files are larger than 25 MB. Nothing was sent." }, 413);
    throw error;
  }
}

class TooLarge extends Error {}

/** Reads the body up to the limit. A request with no Content-Length (chunked) also stops at it. */
async function readLimited(body: ReadableStream<Uint8Array> | null) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
