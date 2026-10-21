import { createHash, randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";

import type { EntryContext, RouterContextProvider } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { themeScript } from "./lib/theme-script";

export const streamTimeout = 5_000;

// The theme script is the same on each page, so a hash allows it. The scripts
// that React Router writes change on each page, so they get the nonce.
const themeScriptHash = createHash("sha256").update(themeScript).digest("base64");

/**
 * The content security policy of a page. Scripts come only from this origin or
 * carry the nonce. An email shows in an about:blank frame, which gets this
 * policy too, so images can come from any host and styles can be inline. There
 * is no form-action: the agent consent form redirects to the agent's own URL.
 */
function contentSecurityPolicy(nonce: string, https: boolean) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${themeScriptHash}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src * data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ];
  // Over plain HTTP, as in local tests, an upgrade would break the page's own scripts.
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Pages and data show the user's mail, so shared caches must not keep them. */
function setPrivateCache(headers: Headers) {
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-cache");
}

export function handleDataRequest(response: Response) {
  setPrivateCache(response.headers);
  return response;
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  setPrivateCache(responseHeaders);

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const nonce = randomBytes(16).toString("base64");
  responseHeaders.set("Content-Security-Policy", contentSecurityPolicy(nonce, new URL(request.url).protocol === "https:"));

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Bots and SPA mode renders wait for all content to load before the response.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    // Stop the render after streamTimeout, so the rejected boundaries have time to flush.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // handleDocumentRequest logs the errors of the shell. Log only the later ones.
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}
