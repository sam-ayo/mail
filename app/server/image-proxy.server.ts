import { createHmac, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { env } from "./env.server";
import { isUnsafeUrl, safeLookup } from "./safe-net.server";

// The server fetches the remote images in emails, so senders do not get the
// reader's IP address. Vercel limits a function response to 4.5 MB, so the
// server makes larger images smaller. Emails show images at about 600 px wide.
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SHRINK_OVER_BYTES = 1024 * 1024;
const SHRINK_WIDTH = 1600;
const SHRINKABLE = /^image\/(jpeg|png|webp|gif|avif|tiff)$/;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 10_000;
const IMAGE_TYPE = /^image\/[a-z0-9.+-]+$/;
// Some image servers send no type, or a generic binary type. Then the proxy
// finds the type from the first bytes of the file, as browsers do.
const GENERIC_TYPE = /^$|^(application|binary)\/octet-stream$/;

// The sanitizer signs each proxy URL. Then the proxy needs no session, and
// the CDN can keep its responses for all users. Only the URLs in emails get
// a signature, so the proxy does not fetch other URLs.
const signingKey = createHmac("sha256", env.sessionSecret).update("image-proxy").digest();

function signature(url: string) {
  return createHmac("sha256", signingKey).update(url).digest("base64url").slice(0, 22);
}

/** True if the signature is from proxiedImageUrl for this URL. */
export function isSignedImageUrl(url: string, given: string) {
  const expected = Buffer.from(signature(url));
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Changes a remote image URL to the app's signed proxy URL. Other URLs do not change. */
export function proxiedImageUrl(src: string) {
  let url = src.trim();
  if (url.startsWith("//")) url = `https:${url}`;
  else if (!/^https?:\/\//i.test(url)) return url;
  return `/api/image?url=${encodeURIComponent(url)}&s=${signature(url)}`;
}

function get(url: URL, signal: AbortSignal) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(url, {
      lookup: safeLookup,
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MailImageProxy/1.0; +https://mail.samayo.me)",
        Accept: "image/avif,image/webp,image/png,image/*;q=0.8",
        "Accept-Encoding": "identity",
      },
    });
    request.on("response", resolve);
    request.on("error", reject);
  });
}

/** Fetches a remote image. Returns null if the URL is not safe, or the response is not an image. */
export async function fetchRemoteImage(raw: string) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isUnsafeUrl(url)) return null;

    const response = await get(url, signal);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }

    const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const length = Number(response.headers["content-length"] ?? 0);
    const generic = GENERIC_TYPE.test(contentType);
    if (status !== 200 || !(generic || IMAGE_TYPE.test(contentType)) || length > MAX_DOWNLOAD_BYTES) {
      response.destroy();
      return null;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        return null;
      }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    const type = generic ? sniffImageType(data) : contentType;
    return type ? shrink({ data, contentType: type }) : null;
  }
  return null;
}

/** Finds the image type from the first bytes. SVG is text, so it is not found here. */
export function sniffImageType(data: Buffer) {
  const ascii = (start: number, end: number) => data.toString("latin1", start, end);
  if (data.length < 12) return null;
  if (data[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
  if (ascii(0, 2) === "BM") return "image/bmp";
  if (data.readUInt32BE(0) === 0x00000100) return "image/x-icon";
  return null;
}

/** Makes a large image smaller as WebP. Returns null if the image stays too large to send. */
async function shrink(image: { data: Buffer; contentType: string }) {
  if (image.data.length <= SHRINK_OVER_BYTES || !SHRINKABLE.test(image.contentType)) {
    return image.data.length <= MAX_RESPONSE_BYTES ? image : null;
  }
  try {
    // Load sharp only here. If its native binary fails to load, only large images fail.
    const { default: sharp } = await import("sharp");
    const data = await sharp(image.data, { animated: true })
      .rotate()
      .resize({ width: SHRINK_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const smaller = data.length < image.data.length ? { data, contentType: "image/webp" } : image;
    return smaller.data.length <= MAX_RESPONSE_BYTES ? smaller : null;
  } catch {
    return image.data.length <= MAX_RESPONSE_BYTES ? image : null;
  }
}
