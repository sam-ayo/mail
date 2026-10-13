import { listAccounts } from "~/server/accounts.server";
import { requireUserId } from "~/server/auth.server";
import type { DemoDataset } from "~/server/providers/demo.server";
import { setDemoDataset } from "~/server/providers/demo.server";
import type { Route } from "./+types/api.dev.demo-data";

/** Development only. Swaps the demo mailbox between sample and worst-case data. */
export async function action({ request }: Route.ActionArgs) {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const userId = await requireUserId(request);
  const form = await request.formData();
  const dataset: DemoDataset = form.get("dataset") === "worst" ? "worst" : "demo";
  for (const account of await listAccounts(userId)) {
    if (account.provider === "demo") setDemoDataset(account.id, dataset);
  }
  return { dataset };
}
