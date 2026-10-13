import { redirect } from "react-router";
import { signOut } from "~/server/auth.server";
import type { Route } from "./+types/logout";

export const loader = () => redirect("/");

export async function action({ request }: Route.ActionArgs) {
  return signOut(request);
}
