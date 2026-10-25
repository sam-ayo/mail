import { requireUserId } from "~/server/auth.server";
import { fetchRemoteImage } from "~/server/image-proxy.server";
import type { Route } from "./+types/api.image";

// Loads the remote images in emails for the browser. The sender's server sees
// the app's server, not the reader's IP address or location.
export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  const url = new URL(request.url).searchParams.get("url");
  if (!url || url.length > 4096) return new Response("Missing url", { status: 400 });

  const image = await fetchRemoteImage(url).catch(() => null);
  if (!image) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.data.length),
      // An SVG image must never run code in the app's origin.
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
