import { redirect } from "react-router";
import { getUserId } from "~/server/auth.server";
import { isDemoHost } from "~/server/demo-accounts.server";
import type { Route } from "./+types/index";

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) return redirect("/mail");
  return redirect(isDemoHost(request) ? "/demo" : "/welcome");
}
