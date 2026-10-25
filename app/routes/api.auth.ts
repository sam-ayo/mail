import { getAgentAuth } from "~/server/agent-auth.server";
import type { Route } from "./+types/api.auth";

// The OAuth endpoints for AI agents: authorize, token, register, JWKS, and the others.
export const loader = ({ request }: Route.LoaderArgs) => getAgentAuth().handler(request);
export const action = ({ request }: Route.ActionArgs) => getAgentAuth().handler(request);
