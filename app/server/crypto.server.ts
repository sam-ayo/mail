import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env.server";

// AES-256-GCM. The stored format is "v2.<key ID>.<iv>.<tag>.<ciphertext>" in
// base64url. The key ID tells which key encrypted the value, so a new
// ENCRYPTION_KEY can replace the old one without a loss of data. See
// "Rotate the encryption key" in README.md. Values from before key IDs have the
// format "v1.<iv>.<tag>.<ciphertext>", and each known key can decrypt them.

type Key = { id: string; bytes: Buffer };

function toKey(secret: string): Key {
  const bytes = createHash("sha256").update(secret).digest();
  // A hash of the key, not the key. It names the key in the stored value.
  const id = createHash("sha256").update("mail key id").update(bytes).digest("base64url").slice(0, 8);
  return { id, bytes };
}

const currentKey = toKey(env.encryptionKey);
const keys = [currentKey, ...env.previousEncryptionKeys.map(toKey)];
const keysById = new Map(keys.map((key) => [key.id, key]));

/** The start of each value that the current key encrypted. */
export const currentKeyPrefix = `v2.${currentKey.id}.`;

export function encrypt(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", currentKey.bytes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", currentKey.id, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decrypt(payload: string) {
  const parts = payload.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const key = keysById.get(parts[1]);
    if (!key) throw new Error(`Unknown encryption key ${parts[1]}. Add it to ENCRYPTION_KEY_PREVIOUS.`);
    return decryptWith(key, parts[2], parts[3], parts[4]);
  }
  if (parts[0] === "v1" && parts.length === 4) {
    // A v1 value does not name its key. The GCM tag fails for a wrong key, so try each key.
    for (const key of keys) {
      try {
        return decryptWith(key, parts[1], parts[2], parts[3]);
      } catch {}
    }
    throw new Error("No encryption key decrypts this value. Add the old key to ENCRYPTION_KEY_PREVIOUS.");
  }
  throw new Error("Unknown encryption format");
}

function decryptWith(key: Key, iv: string, tag: string, ciphertext: string) {
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, Buffer.from(iv, "base64url"));
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
