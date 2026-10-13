import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env.server";

// AES-256-GCM. The stored format is "v1.<iv>.<tag>.<ciphertext>" in base64url.
const key = createHash("sha256").update(env.encryptionKey).digest();

export function encrypt(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, ciphertext].map((part) =>
    typeof part === "string" ? part : part.toString("base64url"),
  ).join(".");
}

export function decrypt(payload: string) {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1") throw new Error("Unknown encryption format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Base64Url(input: string) {
  return createHash("sha256").update(input).digest("base64url");
}
