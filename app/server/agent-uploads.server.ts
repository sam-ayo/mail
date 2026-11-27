import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { query, queryOne } from "./db.server";
import { env } from "./env.server";

/**
 * Files that an AI agent uploads to attach to an email. An agent with a shell,
 * such as Claude Code, sends a file from the disk to a single-use URL with
 * curl. Thus the bytes do not go through the model, and a file of normal size
 * is no problem. The MCP tools then attach the file by its upload ID.
 */

/** The same limit as the attachments of one email. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** The time to upload the file and to send it. A compose view can send again within this time. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000;
/**
 * The most bytes that the uploads of one workspace, and of all workspaces,
 * can use at the same time. The rows are in the production database, which
 * has a size limit. An upload expires after one hour and then frees its bytes.
 */
export const MAX_WORKSPACE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD_BYTES = 250 * 1024 * 1024;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Makes an empty upload for the workspace. Returns the ID and the URL with its secret. */
export async function createUpload(userId: string, filename: string, contentType?: string) {
  await deleteExpiredUploads();
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  await query(
    `INSERT INTO agent_uploads (id, user_id, token_hash, filename, content_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, hash(token), filename, contentType ?? null, expiresAt],
  );
  return { id, url: `${env.appUrl}/api/agent-uploads/${id}?token=${token}`, expiresAt };
}

/** Saves the bytes of an upload. The URL secret must match, and an upload takes bytes only once. */
export async function storeUpload(id: string, token: string, body: ReadableStream<Uint8Array> | null, contentType?: string) {
  const row = await queryOne<{ user_id: string; token_hash: string; uploaded_at: Date | null; expires_at: Date }>(
    "SELECT user_id, token_hash, uploaded_at, expires_at FROM agent_uploads WHERE id = $1",
    [id],
  );
  const given = Buffer.from(hash(token));
  if (!row || !timingSafeEqual(given, Buffer.from(row.token_hash))) {
    throw new UploadError("This upload URL is not valid.", 404);
  }
  if (row.expires_at.getTime() < Date.now()) throw new UploadError("This upload URL expired. Call create_upload again.", 410);
  if (row.uploaded_at) throw new UploadError("This upload URL was used already. Call create_upload again.", 409);

  const data = await readLimited(body);
  if (data.length === 0) throw new UploadError("The upload is empty. Send the file as the request body.", 400);
  await checkSpace(row.user_id, data.length);
  const saved = await queryOne<{ id: string }>(
    `UPDATE agent_uploads
     SET data = $2, size = $3, uploaded_at = now(),
         content_type = COALESCE(content_type, $4)
     WHERE id = $1 AND uploaded_at IS NULL
     RETURNING id`,
    [id, data, data.length, usefulType(contentType)],
  );
  if (!saved) throw new UploadError("This upload URL was used already. Call create_upload again.", 409);
  return { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

/**
 * Saves a file that the server has already, as an upload that is complete.
 * compose_message uses it for a downloaded file, so that Send in the view does
 * not download the file again: a signed URL can expire in the meantime.
 */
export async function storeFile(userId: string, file: { filename: string; contentType: string; content: Buffer }) {
  await checkSpace(userId, file.content.length);
  const id = randomUUID();
  await query(
    `INSERT INTO agent_uploads (id, user_id, token_hash, filename, content_type, data, size, uploaded_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`,
    [
      id,
      userId,
      // No upload URL: a random hash that no secret matches.
      hash(randomBytes(32).toString("base64url")),
      file.filename,
      file.contentType || null,
      file.content,
      file.content.length,
      new Date(Date.now() + UPLOAD_TTL_MS),
    ],
  );
  return id;
}

/** Throws when the new bytes would put the workspace or the server over the upload limit. */
async function checkSpace(userId: string, bytes: number) {
  await deleteExpiredUploads();
  const used = await queryOne<{ mine: string; total: string }>(
    `SELECT COALESCE(SUM(size) FILTER (WHERE user_id = $1), 0) AS mine, COALESCE(SUM(size), 0) AS total
     FROM agent_uploads WHERE data IS NOT NULL`,
    [userId],
  );
  if (Number(used?.mine) + bytes > MAX_WORKSPACE_UPLOAD_BYTES) {
    throw new UploadError(
      "The uploads of this workspace use 50 MB. Each upload frees its space one hour after create_upload. Try again later.",
      507,
    );
  }
  if (Number(used?.total) + bytes > MAX_TOTAL_UPLOAD_BYTES) {
    throw new UploadError("The server has no space for uploads now. Try again in one hour, or use a url.", 507);
  }
}

/** The file of an upload of the workspace, for an attachment. */
export async function getUpload(userId: string, id: string) {
  const row = await queryOne<{
    filename: string;
    content_type: string | null;
    data: Buffer | null;
    expires_at: Date;
  }>("SELECT filename, content_type, data, expires_at FROM agent_uploads WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
  if (!row) throw new Error(`There is no upload ${id}. Call create_upload to get one.`);
  if (row.expires_at.getTime() < Date.now()) throw new Error(`The upload ${id} expired. Call create_upload again.`);
  if (!row.data) {
    throw new Error(`The file of upload ${id} is not there yet. Send it to the upload_url first, then try again.`);
  }
  return { filename: row.filename, contentType: row.content_type ?? "", content: row.data };
}

export async function deleteExpiredUploads() {
  await query("DELETE FROM agent_uploads WHERE expires_at < now()");
}

/** curl -T sends application/octet-stream or nothing, so the server keeps only a specific type. */
function usefulType(contentType: string | undefined) {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!type || type === "application/octet-stream" || type === "application/x-www-form-urlencoded") return null;
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : null;
}

async function readLimited(body: ReadableStream<Uint8Array> | null) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new UploadError("The file is larger than 25 MB.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
