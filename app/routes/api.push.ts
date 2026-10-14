import { data } from "react-router";
import { requireUserId } from "~/server/auth.server";
import { env } from "~/server/env.server";
import type { PushSubscriptionInput } from "~/server/push.server";
import { deleteSubscription, pushConfigured, saveSubscription } from "~/server/push.server";
import type { Route } from "./+types/api.push";

/** The public key that the browser needs to make a subscription. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  return Response.json({ publicKey: pushConfigured ? env.push.publicKey : null });
}

/** POST saves the subscription of this device. DELETE removes it. */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json().catch(() => null)) as Partial<PushSubscriptionInput> | null;
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    throw data("Invalid subscription", { status: 400 });
  }
  if (request.method === "DELETE") {
    await deleteSubscription(userId, endpoint);
    return new Response(null, { status: 204 });
  }
  const { p256dh, auth } = body?.keys ?? {};
  if (typeof p256dh !== "string" || typeof auth !== "string") throw data("Invalid subscription", { status: 400 });
  await saveSubscription(userId, { endpoint, keys: { p256dh, auth } });
  return new Response(null, { status: 204 });
}
