import { isFolder, mergeDuplicates } from "~/lib/mail";
import { requireUserId } from "~/server/auth.server";
import { listThreads } from "~/server/mail.server";
import { ProviderError } from "~/server/providers/types";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/api.v1.threads";

/** Lists conversations: `?scope=all|<accountId>&folder=inbox&q=&cursor=`. */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") ?? "inbox";
  if (!isFolder(folder)) return Response.json({ error: "Folder not found" }, { status: 404 });
  const scope = url.searchParams.get("scope") ?? "all";
  try {
    const result = await listThreads(userId, {
      scope,
      folder,
      query: url.searchParams.get("q")?.trim() ?? "",
      cursor: url.searchParams.get("cursor"),
    });
    const threads = scope === "all" ? mergeDuplicates(result.threads) : result.threads;
    return Response.json({ ...result, threads }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof ProviderError && error.status === 404 ? 404 : 502;
    return Response.json({ error: errorMessage(error) }, { status });
  }
}
