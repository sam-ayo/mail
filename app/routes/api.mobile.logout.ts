import { bearerToken, deleteMobileSession } from "~/server/mobile.server";
import type { Route } from "./+types/api.mobile.logout";

export async function action({ request }: Route.ActionArgs) {
  const token = bearerToken(request);
  if (token) await deleteMobileSession(token);
  return new Response(null, { status: 204 });
}
