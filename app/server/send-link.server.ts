import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { MessageInput } from "./agent-email.server";
import { env } from "./env.server";

/**
 * The single-use URL of send_with_files. The URL itself carries the email
 * (workspace, agent, and tool input), compressed and encrypted, so the server
 * stores no email and no file. The upload request sends the email with the
 * files of the request. The server keeps those files only in memory for that
 * request.
 */

/** The time to run the upload command. */
export const SEND_LINK_TTL_MS = 60 * 60 * 1000;
/** Node limits the request line and headers to 16 KB, so the token must stay well below it. */
const MAX_TOKEN_CHARS = 10_000;

// A key of its own, so a send link cannot decrypt or forge another value of the app.
const key = createHash("sha256").update(env.encryptionKey).update("agent send link").digest();

interface SendLink {
  /** Workspace. */
  u: string;
  /** OAuth client of the agent, to check that the user did not disconnect it. */
  c: string;
  /** Expiry, in milliseconds since 1970. */
  e: number;
  /** Random ID. The server records it after a send, so the URL sends only once. */
  n: string;
  /** The tool input. */
  m: MessageInput;
}

export class SendLinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createSendLink(userId: string, clientId: string, input: MessageInput) {
  const link: SendLink = {
    u: userId,
    c: clientId,
    e: Date.now() + SEND_LINK_TTL_MS,
    n: randomBytes(12).toString("base64url"),
    m: input,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(deflateRawSync(JSON.stringify(link))), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  if (token.length > MAX_TOKEN_CHARS) {
    throw new Error(
      "The email is too long for an upload URL. Make the body shorter, or send the long text as a file.",
    );
  }
  return { url: `${env.appUrl}/api/agent-send?t=${token}`, expiresAt: new Date(link.e), nonce: link.n };
}

/** Reads a send link. Throws a SendLinkError for a link that is not valid or that expired. */
export function openSendLink(token: string): SendLink {
  let link: SendLink;
  try {
    const data = Buffer.from(token, "base64url");
    if (data.length < 29 || token.length > MAX_TOKEN_CHARS) throw new Error("too short or long");
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
    link = JSON.parse(inflateRawSync(plain).toString("utf8")) as SendLink;
  } catch {
    throw new SendLinkError("This upload URL is not valid. Call send_with_files again.", 404);
  }
  if (!(link.e > Date.now())) throw new SendLinkError("This upload URL expired. Call send_with_files again.", 410);
  return link;
}
