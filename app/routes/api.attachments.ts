import { requireUserId } from "~/server/auth.server";
import { getAttachment } from "~/server/mail.server";
import { ProviderError } from "~/server/providers/types";
import type { Route } from "./+types/api.attachments";

// Types that are safe to show in the browser. Other types always download.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/;

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const messageId = url.searchParams.get("m");
  const attachmentId = url.searchParams.get("a");
  if (!messageId || !attachmentId) return new Response("Missing parameters", { status: 400 });

  try {
    const file = await getAttachment(userId, params.accountId, messageId, attachmentId);
    const mimeType = file.mimeType.toLowerCase();
    const inline = INLINE_TYPES.test(mimeType) && !url.searchParams.has("download");
    const filename = encodeURIComponent(file.filename);
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(file.data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
        // An attachment must never run code in the app's origin.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const status = error instanceof ProviderError && error.status === 404 ? 404 : 502;
    return new Response(status === 404 ? "Attachment not found" : "Could not load the attachment", {
      status,
    });
  }
}
