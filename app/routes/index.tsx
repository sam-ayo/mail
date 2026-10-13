import { redirect } from "react-router";
import { getUserId } from "~/server/auth.server";
import type { Route } from "./+types/index";

export async function loader({ request }: Route.LoaderArgs) {
  return redirect((await getUserId(request)) ? "/mail" : "/welcome");
}
