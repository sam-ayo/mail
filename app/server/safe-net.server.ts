import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

// Addresses in private networks, the server itself, and cloud metadata
// services. Email content chooses the URLs that the server fetches (images,
// sender logos, unsubscribe links), so it must not reach these addresses.
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
  // IPv4-compatible addresses (::a.b.c.d), and :: and ::1.
  ["::", 96],
  // BlockList applies the IPv4 rules to IPv4-mapped addresses (::ffff:10.0.0.1).
  // A rule for ::ffff:0:0/96 here would block all IPv4 addresses.
  // NAT64, Teredo and 6to4 addresses can contain an internal IPv4 address.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isBlockedAddress(address: string) {
  return blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A DNS lookup that drops blocked addresses. The check runs on each
 * connection, after DNS. A host that gives a public address to a first lookup
 * and a private address later (DNS rebinding) is still blocked.
 */
export function safeLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const allowed = addresses.filter((entry) => !isBlockedAddress(entry.address));
    if (allowed.length === 0) return callback(new Error(`Blocked address for ${hostname}`), "");
    if (options.all) callback(null, allowed);
    else callback(null, allowed[0].address, allowed[0].family);
  });
}

/** True if the URL can go to a blocked address with no DNS lookup, or has a user name or password. */
export function isUnsafeUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return true;
  if (url.username || url.password) return true;
  // A literal IP address skips the DNS lookup, so check it here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return isIP(host) !== 0 && isBlockedAddress(host);
}

/**
 * One HTTP request that connects only to allowed addresses. It does not follow
 * redirects: the caller must check each new URL.
 */
export function safeRequest(
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {},
) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    if (isUnsafeUrl(url)) return reject(new Error("Blocked URL"));
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: init.method ?? "GET",
      lookup: safeLookup,
      signal: init.signal,
      headers: init.headers,
    });
    request.on("response", resolve);
    request.on("error", reject);
    request.end(init.body);
  });
}

/** safeRequest with a fetch Response, for code that reads a Response. */
export async function safeFetchResponse(url: URL, init: Parameters<typeof safeRequest>[1] = {}) {
  const response = await safeRequest(url, init);
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
  }
  const status = response.statusCode ?? 0;
  const empty = status === 204 || status === 304 || (status >= 100 && status < 200);
  if (empty) response.resume();
  // A Response cannot have status 1xx or a status above 599.
  return new Response(empty ? null : (Readable.toWeb(response) as ReadableStream), {
    status: status >= 200 && status <= 599 ? status : 502,
    headers,
  });
}
