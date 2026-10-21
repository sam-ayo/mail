import { createHash } from "node:crypto";
import { lookup, resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { getDomain, getPublicSuffix } from "tldts";

export interface AvatarImage {
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
  /** The width in pixels, or undefined for an SVG, a JPEG or a WebP image. */
  width?: number;
}

const IMAGE_TYPES =
  /^image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 4;
// An avatar shows at 40 pixels at most. A 2x screen needs about 80 pixels, so a smaller logo is blurry.
const SHARP_WIDTH = 64;
const USER_AGENT = "Mozilla/5.0 (compatible; mailbysamayo/1.0; +https://mail.samayo.me)";

// The logo of these domains is the logo of the mail service, not of the person.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "gmx.de", "mail.com",
  "yandex.com", "yandex.ru", "zoho.com", "fastmail.com", "hey.com", "tutanota.com",
  "qq.com", "163.com", "web.de",
]);

/**
 * The main site of a government. Departments often send mail from a domain
 * with no site, such as ircc-ircc.gc.ca, and then this site gives the logo.
 */
const GOVERNMENT_SITES: Record<string, string> = {
  "gc.ca": "canada.ca",
  "gov.uk": "gov.uk",
  "gov.au": "australia.gov.au",
  "govt.nz": "govt.nz",
  "gov.ie": "gov.ie",
  "gouv.fr": "service-public.fr",
  "gov.in": "india.gov.in",
  "gov.sg": "gov.sg",
  "gov.za": "gov.za",
  "gov.ng": "nigeria.gov.ng",
  "gov": "usa.gov",
};

function isPrivateAddress(address: string) {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return lower === "::1" || lower === "::" || /^f[cd]|^fe[89ab]/.test(lower);
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127) || a! >= 224
  );
}

/**
 * Reads the body, and stops when it is larger than `limit`. With `truncate`,
 * gives the first `limit` bytes. Without it, gives null.
 */
async function readLimited(response: Response, limit: number, truncate: boolean) {
  if (!truncate && Number(response.headers.get("content-length") ?? 0) > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > limit) {
      await reader.cancel();
      if (!truncate) return null;
      chunks.push(value.subarray(0, limit - size));
      size = limit;
      break;
    }
    size += value.length;
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

/**
 * Downloads a URL. Sites and BIMI records can point to any URL, so each URL,
 * also each redirect, must use HTTPS and must not go to a private network address.
 */
async function safeFetch(url: string, accept: string, limit: number, truncate = false) {
  try {
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "https:") return null;
      const addresses = await lookup(current.hostname, { all: true });
      if (addresses.some(({ address }) => isPrivateAddress(address))) return null;

      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: accept, "User-Agent": USER_AGENT },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) return null;
      const contentType =
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const data = await readLimited(response, limit, truncate);
      if (!data || data.length === 0) return null;
      return { data, contentType, url: current };
    }
  } catch {
    // A network error, a timeout, or a bad URL.
  }
  return null;
}

/** The width of a PNG, GIF or ICO image, or undefined for other types. */
function imageWidth(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 24 && view.getUint32(0) === 0x89504e47) return view.getUint32(16);
  if (data.length >= 10 && view.getUint32(0) === 0x47494638) return view.getUint16(6, true);
  if (data.length >= 22 && view.getUint32(0) === 0x00000100) {
    // An ICO file holds several images. A width of 0 means 256.
    let widest = 0;
    for (let i = 0; i < view.getUint16(4, true) && 6 + i * 16 < data.length; i++) {
      widest = Math.max(widest, data[6 + i * 16] || 256);
    }
    return widest;
  }
  return undefined;
}

/** A data URL in the page, such as "data:image/svg+xml;base64,...". */
function decodeDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+)((?:;[^;,]*)*),(.*)$/s);
  if (!match) return null;
  try {
    const data = match[2]!.includes(";base64")
      ? Buffer.from(match[3]!, "base64")
      : Buffer.from(decodeURIComponent(match[3]!));
    return { data: new Uint8Array(data), contentType: match[1]!.toLowerCase() };
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<AvatarImage | null> {
  const result = url.startsWith("data:")
    ? decodeDataUrl(url)
    : await safeFetch(url, "image/*", MAX_IMAGE_BYTES);
  if (!result || !IMAGE_TYPES.test(result.contentType)) return null;
  if (result.data.length === 0 || result.data.length > MAX_IMAGE_BYTES) return null;
  // A very small image, such as a 1 by 1 pixel, is not a logo.
  const width = imageWidth(result.data);
  if ((width ?? 16) < 16) return null;
  return { data: result.data, contentType: result.contentType, width };
}

/** The brand logo from the BIMI record of the domain or its registered domain. */
async function bimiLogo(hosts: string[]) {
  for (const host of hosts) {
    try {
      const records = await resolveTxt(`default._bimi.${host}`);
      const record = records.map((chunks) => chunks.join("")).find((text) => /^v=BIMI1/i.test(text));
      const location = record?.match(/(?:^|;)\s*l=([^;]+)/i)?.[1]?.trim();
      if (location) return await fetchImage(location);
      if (record) return null;
    } catch {
      // No record. Try the next domain.
    }
  }
  return null;
}

function isSharp(image: AvatarImage) {
  return image.width === undefined || image.width >= SHARP_WIDTH;
}

/**
 * The first sharp image, in the order of the list. When all images are small,
 * the widest image. All the lookups start at the same time, so a slow site
 * does not delay the next source.
 */
async function bestInOrder(lookups: Promise<AvatarImage | null>[]) {
  let widest: AvatarImage | null = null;
  for (const lookup of lookups) {
    const result = await lookup;
    if (!result) continue;
    if (isSharp(result)) return result;
    if (!widest || result.width! > widest.width!) widest = result;
  }
  return widest;
}

interface IconLink {
  url: string;
  score: number;
}

function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    result[match[1]!.toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? "").replace(/&amp;/g, "&");
  }
  return result;
}

/** A higher score is a better logo: an SVG, then the largest image. */
function iconScore(sizes: string | undefined, type: string | undefined, href: string, fallback: number) {
  if (type === "image/svg+xml" || /\.svg(\?|$)/i.test(href) || /\bany\b/i.test(sizes ?? "")) return 1000;
  const largest = Math.max(0, ...[...(sizes ?? "").matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])));
  return largest || fallback;
}

/** The icons that a home page declares in its link tags and its web app manifest. */
async function declaredIcons(html: string, base: URL): Promise<IconLink[]> {
  const bodyStart = html.search(/<body[\s>]/i);
  const head = bodyStart > 0 ? html.slice(0, bodyStart) : html;
  const icons: IconLink[] = [];
  let manifest: string | undefined;
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const { rel = "", href, sizes, type } = attributes(tag);
    if (!href) continue;
    const rels = rel.toLowerCase().split(/\s+/);
    try {
      if (rels.includes("manifest")) manifest = new URL(href, base).href;
      // A mask icon has one color only, so it is not a good logo.
      if (rels.includes("mask-icon")) continue;
      if (rels.includes("apple-touch-icon") || rels.includes("apple-touch-icon-precomposed")) {
        icons.push({ url: new URL(href, base).href, score: iconScore(sizes, type, href, 180) });
      } else if (rels.includes("icon")) {
        icons.push({ url: new URL(href, base).href, score: iconScore(sizes, type, href, 32) });
      }
    } catch {
      // A bad URL in the page.
    }
  }

  if (manifest) {
    const result = await safeFetch(manifest, "application/manifest+json, application/json", MAX_PAGE_BYTES);
    try {
      const parsed = JSON.parse(new TextDecoder().decode(result?.data)) as {
        icons?: { src?: string; sizes?: string; type?: string; purpose?: string }[];
      };
      for (const icon of parsed.icons ?? []) {
        if (!icon.src || icon.purpose === "monochrome") continue;
        icons.push({
          url: new URL(icon.src, result!.url).href,
          score: iconScore(icon.sizes, icon.type, icon.src, 32),
        });
      }
    } catch {
      // No manifest, or a bad one.
    }
  }
  return icons.sort((a, b) => b.score - a.score);
}

/**
 * The logo of the site at the host. The home page can redirect, for example
 * from cic.gc.ca to ircc.canada.ca, so the icon URLs use the last URL.
 */
async function siteLogo(host: string) {
  const origins = host.startsWith("www.") ? [host] : [host, `www.${host}`];
  for (const origin of origins.map((name) => `https://${name}/`)) {
    // A large page, such as github.com, has its icon links in the head at the start.
    const page = await safeFetch(origin, "text/html", MAX_PAGE_BYTES, true);
    if (!page || !page.contentType.includes("html")) continue;

    const icons = await declaredIcons(new TextDecoder().decode(page.data), page.url);
    const urls = [
      ...icons.slice(0, 3).map(({ url }) => url),
      ...["/apple-touch-icon.png", "/favicon.ico"].map((path) => new URL(path, page.url).href),
    ];
    return bestInOrder([...new Set(urls)].map(fetchImage));
  }
  return null;
}

/** Icon services know sites that block the server, such as sites behind a bot check. */
async function iconServiceLogo(domain: string) {
  return bestInOrder([
    fetchImage(`https://icons.duckduckgo.com/ip3/${domain}.ico`),
    fetchImage(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`),
  ]);
}

function gravatar(email: string) {
  const hash = createHash("sha256").update(email).digest("hex");
  return fetchImage(`https://gravatar.com/avatar/${hash}?s=128&d=404`);
}

/**
 * The hosts to try, from the most specific: "news.ircc.canada.ca" gives
 * "news.ircc.canada.ca", "ircc.canada.ca" and "canada.ca". Mail often comes
 * from a subdomain, such as em.dell.com, that has no site of its own.
 */
function hostsFor(domain: string) {
  const registered = getDomain(domain) ?? domain;
  const hosts = [domain];
  let host = domain;
  while (host !== registered && host.includes(".")) {
    host = host.slice(host.indexOf(".") + 1);
    hosts.push(host);
  }
  return hosts.slice(-3);
}

async function resolveDomain(domain: string): Promise<AvatarImage | null> {
  const hosts = hostsFor(domain);
  const registered = hosts.at(-1)!;
  const government = GOVERNMENT_SITES[getPublicSuffix(domain) ?? ""];
  return bestInOrder([
    bimiLogo([...new Set([domain, registered])]),
    ...hosts.map(siteLogo),
    iconServiceLogo(registered),
    government && government !== registered ? domainLogo(government) : Promise.resolve(null),
  ]);
}

/**
 * The domain in ASCII form ("münchen.de" gives "xn--mnchen-3ya.de"), or null
 * for a value that is not a public domain name, such as an IP address.
 */
function toAsciiDomain(value: string) {
  // A path, a port, a user name or an IPv6 address is not part of a domain.
  if (/[\s/\\?#@:[\]%]/.test(value)) return null;
  try {
    const domain = new URL(`https://${value.replace(/\.$/, "")}/`).hostname;
    if (!/^[a-z0-9.-]+\.(xn--[a-z0-9-]+|[a-z]{2,})$/.test(domain)) return null;
    return getPublicSuffix(domain) === domain ? null : domain;
  } catch {
    return null;
  }
}

// The server keeps the recent results, also the misses, for one day.
const CACHE_SIZE = 1000;
const CACHE_MS = 24 * 60 * 60 * 1000;

function cached<T>(load: (key: string) => Promise<T>) {
  const cache = new Map<string, { value: Promise<T>; expires: number }>();
  return (key: string) => {
    const entry = cache.get(key);
    if (entry && entry.expires > Date.now()) return entry.value;
    const value = load(key).catch(() => null as T);
    cache.delete(key);
    cache.set(key, { value, expires: Date.now() + CACHE_MS });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return value;
  };
}

// Many senders share a domain, so the server looks up each domain once.
const domainLogo = cached(resolveDomain);

/**
 * The logo of the sender's organization comes first. Gravatar is the fallback,
 * and the only source for addresses at a personal mail service.
 */
const emailLogo = cached(async (email: string): Promise<AvatarImage | null> => {
  const domain = toAsciiDomain(email.slice(email.lastIndexOf("@") + 1));
  if (!email.includes("@") || !domain) return null;
  const personal = PERSONAL_DOMAINS.has(getDomain(domain) ?? domain);
  return (!personal && (await domainLogo(domain))) || (await gravatar(email));
});

export function avatarFor(email: string) {
  return emailLogo(email.trim().toLowerCase());
}

/** The logo of the company that owns a custom mail domain. A personal mail service has no logo. */
export async function companyLogoFor(value: string) {
  const domain = toAsciiDomain(value.trim().toLowerCase());
  if (!domain || PERSONAL_DOMAINS.has(getDomain(domain) ?? domain)) return null;
  return domainLogo(domain);
}
