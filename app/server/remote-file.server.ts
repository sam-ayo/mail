import { safeFetchResponse } from "./safe-net.server";

/**
 * Downloads a file from a URL that an agent gives, to attach it to an email.
 * The URL can come from email content, so the download uses HTTPS only,
 * connects only to public addresses (also after each redirect), and stops at
 * a size limit and a time limit.
 */

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const USER_AGENT = "mail-by-samayo/1.0 (+https://mail.samayo.me/agents)";

export interface RemoteFile {
  filename: string;
  /** The type from the server, without parameters. Empty if the server sent none. */
  contentType: string;
  content: Buffer;
}

export async function downloadFile(url: string, maxBytes: number): Promise<RemoteFile> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new Error(`${url} is not a valid URL.`);
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "https:") throw new Error("The file URL must use https.");
      let response: Response;
      try {
        // safe-net checks the address of each connection, so DNS rebinding cannot reach a private address.
        response = await safeFetchResponse(current, {
          signal,
          headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Encoding": "identity" },
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(`Could not download ${current.host}: the address is not public or does not answer.`);
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Could not download the file: the server answered HTTP ${response.status}.`);
      }
      const length = Number(response.headers.get("content-length"));
      if (length > maxBytes) {
        await response.body?.cancel();
        throw new Error("The attachments must be 25 MB or less in total.");
      }
      const content = await readLimited(response, maxBytes);
      return {
        filename: filenameOf(response.headers.get("content-disposition"), current),
        contentType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
        content,
      };
    }
    throw new Error("Could not download the file: too many redirects.");
  } catch (error) {
    if (signal.aborted) throw new Error("Could not download the file: the server took more than 30 seconds.");
    throw error;
  }
}

async function readLimited(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("The attachments must be 25 MB or less in total.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The file name from Content-Disposition, else the last part of the URL path. */
export function filenameOf(disposition: string | null, url: URL) {
  if (disposition) {
    const extended = disposition.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
    if (extended) {
      try {
        const name = clean(decodeURIComponent(extended[2].trim().replace(/^"|"$/g, "")));
        if (name) return name;
      } catch {
        // A bad encoding: try the plain file name.
      }
    }
    const plain = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
    const name = clean(plain?.[1] ?? plain?.[2]?.trim() ?? "");
    if (name) return name;
  }
  let last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    last = decodeURIComponent(last);
  } catch {
    // Keep the encoded name.
  }
  return clean(last) || "download";
}

/** Removes path parts and control characters, so a name cannot point to a folder. */
function clean(name: string) {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .pop()!
    .trim()
    .slice(0, 200);
}
