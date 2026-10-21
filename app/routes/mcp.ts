import { createTanStackStartHandler } from "mcp-use/tanstack-start";
import type { Route } from "./+types/mcp";

// The MCP endpoint and the assets of its views, at /mcp/*. The mcpUse() Vite
// plugin runs app/mcp/server.ts in its own environment, and this handler
// forwards to it. The adapter is for TanStack Start, but it is only a fetch
// handler, so it works in any Vite app.
const handle = createTanStackStartHandler();

export const loader = ({ request }: Route.LoaderArgs) => handle(request);
export const action = ({ request }: Route.ActionArgs) => handle(request);
