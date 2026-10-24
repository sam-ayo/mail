import { redirect } from "react-router";
import { isDemoHost } from "~/server/demo-accounts.server";
import { getSession } from "~/server/session.server";
import type { Route } from "./+types/index";

export async function loader({ request }: Route.LoaderArgs) {
  // The cookie is enough, so no query is necessary. The inbox checks the
  // user, and sends a browser with an old session to /welcome.
  const session = await getSession(request);
  if (session.get("userId")) return redirect("/mail/all/inbox");
  return redirect(isDemoHost(request) ? "/demo" : "/welcome");
}
