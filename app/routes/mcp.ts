import { createTanStackStartHandler } from "mcp-use/tanstack-start";
import type { Route } from "./+types/mcp";

// The MCP endpoint and the assets of its views, at /mcp/*. The mcpUse() Vite
// plugin runs app/mcp/server.ts in its own environment, and this handler
// forwards to it. The adapter is for TanStack Start, but it is only a fetch
// handler, so it works in any Vite app.
const handle = createTanStackStartHandler();

// Vercel stops a function after 300 seconds and logs a timeout error. A
// subscriptions/listen stream stays open until the client closes it, so close
// it before that limit. The client then opens a new stream.
const LISTEN_MS = 280_000;

/** The response with a body that ends after `ms`, or earlier when the original body ends. */
function endAfter(response: Response, ms: number): Response {
  const body = response.body;
  if (!body) return response;
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        ended = true;
        controller.close();
        reader.cancel().catch(() => {});
      }, ms);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (ended) return;
      if (done) {
        ended = true;
        clearTimeout(timer);
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      ended = true;
      clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
  return new Response(stream, response);
}

export const loader = ({ request }: Route.LoaderArgs) => handle(request);
export const action = async ({ request }: Route.ActionArgs) => {
  // The 2026-07-28 protocol requires the Mcp-Method header on each request.
  const listen = request.headers.get("mcp-method")?.trim() === "subscriptions/listen";
  const response = await handle(request);
  return listen ? endAfter(response, LISTEN_MS) : response;
};
