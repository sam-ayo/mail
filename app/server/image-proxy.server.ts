import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { env } from "./env.server";

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

// Addresses in private networks, the server itself, and cloud metadata
// services. An email must not make the server fetch from these.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  // BlockList applies the IPv4 rules to IPv4-mapped addresses (::ffff:10.0.0.1).
  // A rule for ::ffff:0:0/96 here would block all IPv4 addresses.
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

function isBlocked(address: string) {
  return blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

// The check runs on each connection, after DNS. A host that gives a public
// address to a first lookup and a private address later is still blocked.
function safeLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const allowed = addresses.filter((entry) => !isBlocked(entry.address));
    if (allowed.length === 0) return callback(new Error(`Blocked address for ${hostname}`), "");
    if (options.all) callback(null, allowed);
    else callback(null, allowed[0].address, allowed[0].family);
  });
}

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
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    // A literal IP address skips the DNS lookup, so check it here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlocked(host)) return null;

    const response = await get(url, signal);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }

    const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const length = Number(response.headers["content-length"] ?? 0);
    if (status !== 200 || !IMAGE_TYPE.test(contentType) || length > MAX_DOWNLOAD_BYTES) {
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
    return shrink({ data: Buffer.concat(chunks), contentType });
  }
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
