import { MAX_UPLOAD_BYTES, storeUpload, UploadError } from "~/server/agent-uploads.server";
import type { Route } from "./+types/api.agent-uploads";

// The single-use upload URL of the create_upload MCP tool. The secret in the
// URL is the authentication: an agent sends a file with
// curl -T file "<url>" (PUT) or curl --data-binary @file "<url>" (POST).

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "PUT" && request.method !== "POST") {
    return Response.json({ error: "Send the file with PUT or POST." }, { status: 405 });
  }
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_UPLOAD_BYTES) return Response.json({ error: "The file is larger than 25 MB." }, { status: 413 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  try {
    const { size, sha256 } = await storeUpload(
      params.id,
      token,
      request.body,
      request.headers.get("content-type") ?? undefined,
    );
    return Response.json({ upload_id: params.id, size, sha256, next: "Attach it with { \"upload_id\": \"" + params.id + "\" }." });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
