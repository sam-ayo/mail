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

/**
 * The push services of the browsers. The server sends a POST to the endpoint,
 * so an endpoint on another host could make the server call any address.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

/** POST saves the subscription of this device. DELETE removes it. */
export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = (await request.json().catch(() => null)) as Partial<PushSubscriptionInput> | null;
  const endpoint = body?.endpoint;
  if (!isPushEndpoint(endpoint)) {
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
