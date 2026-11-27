import { env } from "./env.server";

/**
 * Paths that other sites and servers call with POST: the OAuth and MCP
 * endpoints of the AI agents, the file uploads of the agents, the Resend
 * webhook, and the cron jobs. They do not use the session cookie.
 */
const CROSS_SITE_PATHS = ["/api/auth/", "/mcp", "/api/agent-uploads/", "/api/inbound/", "/api/cron/", "/.well-known/"];

/**
 * Stops cross-site request forgery. The session cookie is SameSite=Lax, and
 * Lax does not stop a POST from another subdomain of samayo.me. Thus a request
 * that changes data must come from a page of this app. Browsers send Origin
 * with each POST. A request with no Origin and no Sec-Fetch-Site does not come
 * from a browser, so it cannot have the cookie of a victim.
 */
export function checkSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const { pathname } = new URL(request.url);
  if (CROSS_SITE_PATHS.some((path) => pathname.startsWith(path))) return;

  const origin = request.headers.get("origin");
  if (origin) {
    if (origin === env.appUrl) return;
    // The app also runs on the demo host, for example mail.demo.samayo.me.
    try {
      const url = new URL(origin);
      if (url.host === request.headers.get("host") && (url.protocol === "https:" || !env.isProduction)) return;
    } catch {
      // A malformed Origin, for example "null", is not this app.
    }
    throw new Response("Forbidden", { status: 403 });
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new Response("Forbidden", { status: 403 });
}
