import { ArrowLeft, Plus, SignOut, Warning } from "@phosphor-icons/react";
import { data, Form, Link, useNavigation } from "react-router";
import { reconnectUrl } from "~/components/sidebar";
import { Button, PROVIDER_NAMES, ProviderIcon, cx, inputClass } from "~/components/ui";
import { ACCOUNT_COLORS } from "~/lib/mail";
import { deleteAccount, listAccounts, toSummary, updateAccountProfile } from "~/server/accounts.server";
import { userContext } from "~/server/context";
import { closeImapConnection } from "~/server/providers/imap.server";
import { resetDemoAccount } from "~/server/providers/demo.server";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => [{ title: "Settings · mail" }];

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  return { accounts: (await listAccounts(user.id)).map(toSummary) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext)!;
  const form = await request.formData();
  const accountId = String(form.get("accountId") ?? "");
  switch (form.get("intent")) {
    case "update": {
      const color = String(form.get("color") ?? "");
      await updateAccountProfile(user.id, accountId, {
        name: String(form.get("name") ?? "").trim(),
        color: ACCOUNT_COLORS.includes(color) ? color : undefined,
      });
      return { saved: accountId };
    }
    case "remove":
      await deleteAccount(user.id, accountId);
      closeImapConnection(accountId);
      resetDemoAccount(accountId);
      return { removed: accountId };
    default:
      throw data("Unknown action", { status: 400 });
  }
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busyId = navigation.formData?.get("accountId");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link
          to="/mail"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="size-4" /> Back to mail
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Email accounts</h2>
              <p className="text-sm text-zinc-500">
                The display name shows as the sender name on mail you send.
              </p>
            </div>
            <Link
              to="/welcome"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
            >
              <Plus className="size-4" /> Add account
            </Link>
          </div>

          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {loaderData.accounts.map((account) => (
              <li key={account.id} className="p-4">
                <Form method="post" className="flex flex-col gap-3">
                  <input type="hidden" name="accountId" value={account.id} />
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      <ProviderIcon provider={account.provider} className="size-4 text-zinc-500" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.email}</p>
                      <p className="text-xs text-zinc-500">{PROVIDER_NAMES[account.provider]}</p>
                    </div>
                    {account.status === "reauth_required" && (
                      <Link
                        to={reconnectUrl(account)}
                        reloadDocument={account.provider !== "imap"}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        <Warning className="size-3.5" /> Sign in again
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      name="name"
                      defaultValue={account.name}
                      placeholder="Display name"
                      aria-label="Display name"
                      className={cx(inputClass, "max-w-60 flex-1")}
                    />
                    <fieldset className="flex gap-1.5" aria-label="Account color">
                      {ACCOUNT_COLORS.map((color) => (
                        <label key={color} className="cursor-pointer">
                          <input
                            type="radio"
                            name="color"
                            value={color}
                            defaultChecked={account.color === color}
                            className="peer sr-only"
                          />
                          <span
                            className="block size-5 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-zinc-400 dark:ring-offset-zinc-950"
                            style={{ background: color }}
                          />
                        </label>
                      ))}
                    </fieldset>
                    <div className="ml-auto flex items-center gap-2">
                      {actionData && "saved" in actionData && actionData.saved === account.id && (
                        <span className="text-xs text-emerald-600">Saved</span>
                      )}
                      <Button name="intent" value="update" disabled={busyId === account.id}>
                        Save
                      </Button>
                      <Button
                        name="intent"
                        value="remove"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        onClick={(event) => {
                          if (!confirm(`Remove ${account.email} from mail? Your mail stays on the server.`)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </Form>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-semibold">Session</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Sign out of mail on this browser. Your connected accounts stay connected.
          </p>
          <Form method="post" action="/logout">
            <Button>
              <SignOut className="size-4" /> Sign out
            </Button>
          </Form>
        </section>
      </div>
    </div>
  );
}
