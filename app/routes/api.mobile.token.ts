import { createMobileSession, redeemAuthCode } from "~/server/mobile.server";
import type { Route } from "./+types/api.mobile.token";

/** Trades the one-time code from the OAuth callback for a bearer token. */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = (await request.json().catch(() => null)) as {
    code?: unknown;
    verifier?: unknown;
    deviceName?: unknown;
  } | null;
  if (typeof body?.code !== "string" || typeof body.verifier !== "string") {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const userId = redeemAuthCode(body.code, body.verifier);
  if (!userId) return Response.json({ error: "The sign-in code expired. Try again." }, { status: 400 });
  const token = await createMobileSession(userId, typeof body.deviceName === "string" ? body.deviceName : "");
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
