import { requireUserId } from "~/server/auth.server";
import { avatarFor, companyLogoFor } from "~/server/avatar.server";
import type { Route } from "./+types/api.avatar";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  const params = new URL(request.url).searchParams;
  const email = params.get("email");
  const domain = params.get("domain");
  // A domain gives the company logo only. An email can also give a Gravatar photo.
  const value = email ?? domain;
  if (!value || value.length > 320) return new Response("Missing email or domain", { status: 400 });

  const image = email ? await avatarFor(email) : await companyLogoFor(value);
  if (!image) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, max-age=86400" },
    });
  }
  return new Response(image.data, {
    headers: {
      "Content-Type": image.contentType,
      // An SVG logo must never run code in the app's origin.
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=604800",
    },
  });
}
