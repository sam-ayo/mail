import { fetchRemoteImage, isSignedImageUrl } from "~/server/image-proxy.server";
import type { Route } from "./+types/api.image";

// Loads the remote images in emails for the browser. The sender's server sees
// the app's server, not the reader's IP address or location.
//
// The URL has a signature from the sanitizer, so the proxy needs no session.
// The response is the same for all users, so the CDN keeps it. Then a
// repeated image needs no function call, and the sender sees only one load.
export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  if (!url || url.length > 4096) return new Response("Missing url", { status: 400 });
  if (!isSignedImageUrl(url, params.get("s") ?? "")) return new Response("Bad signature", { status: 403 });

  const image = await fetchRemoteImage(url).catch(() => null);
  if (!image) {
    return new Response(null, {
      status: 404,
      headers: {
        "Cache-Control": "public, max-age=3600",
        "CDN-Cache-Control": "max-age=3600",
      },
    });
  }
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.data.length),
      // An SVG image must never run code in the app's origin.
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
      "CDN-Cache-Control": "max-age=2592000",
    },
  });
}
