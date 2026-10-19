import { agentAuth } from "~/server/agent-auth.server";
import type { Route } from "./+types/api.auth";

// The OAuth endpoints for AI agents: authorize, token, register, JWKS, and the others.
export const loader = ({ request }: Route.LoaderArgs) => agentAuth.handler(request);
export const action = ({ request }: Route.ActionArgs) => agentAuth.handler(request);
