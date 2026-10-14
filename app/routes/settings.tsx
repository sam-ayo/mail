import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Desktop, Moon, Plus, SignOut, Sun, Trash, Warning } from "~/components/icons";
import { data, Form, Link, useFetcher } from "react-router";
import { removeAccountPrompt, useConfirm } from "~/components/confirm-dialog";
import { reconnectUrl } from "~/components/sidebar";
import { loadPaletteFont, PALETTES, usePalette, useThemeMode, type ThemeMode } from "~/components/theme";
import { AccountIcon, Button, PROVIDER_NAMES, cx, inputClass } from "~/components/ui";
import { ACCOUNT_COLORS, shownProvider, type AccountSummary } from "~/lib/mail";
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
      // Each autosave sends only the field that changed.
      const name = form.get("name");
      const color = String(form.get("color") ?? "");
      await updateAccountProfile(user.id, accountId, {
        name: name == null ? undefined : String(name).trim(),
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

export default function Settings({ loaderData }: Route.ComponentProps) {
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
              <AccountRow key={account.id} account={account} />
            ))}
          </ul>
        </section>

        <Appearance />

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

function AccountRow({ account }: { account: AccountSummary }) {
  // The name and the color save on separate fetchers, so one save does not cancel the other.
  const nameSaver = useFetcher<typeof action>();
  const colorSaver = useFetcher<typeof action>();
  const remover = useFetcher<typeof action>();
  const removing = remover.state !== "idle";
  const confirm = useConfirm();
  const lastName = useRef(account.name);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showSaved, setShowSaved] = useState(false);

  const saving = nameSaver.state !== "idle" || colorSaver.state !== "idle";

  // The name saves after a short pause in typing, or at once when the field loses focus.
  function saveName(name: string, delay: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = name.trim();
      if (trimmed === lastName.current) return;
      lastName.current = trimmed;
      nameSaver.submit({ intent: "update", accountId: account.id, name: trimmed }, { method: "post" });
    }, delay);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (saving || (nameSaver.data == null && colorSaver.data == null)) return;
    setShowSaved(true);
    const hide = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(hide);
  }, [saving, nameSaver.data, colorSaver.data]);

  return (
    <li className={cx("flex flex-col gap-3 p-4", removing && "opacity-50")}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
          <AccountIcon account={account} className="size-5 text-zinc-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.email}</p>
          <p className="text-xs text-zinc-500">{PROVIDER_NAMES[shownProvider(account)]}</p>
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
        <remover.Form method="post">
          <input type="hidden" name="accountId" value={account.id} />
          <button
            name="intent"
            value="remove"
            disabled={removing}
            className="press inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            onClick={async (event) => {
              // The dialog does not block, so stop the submit and send it after the answer.
              event.preventDefault();
              if (await confirm(removeAccountPrompt(account.email))) {
                remover.submit({ intent: "remove", accountId: account.id }, { method: "post" });
              }
            }}
          >
            <Trash className="size-4" /> Remove
          </button>
        </remover.Form>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 sm:pl-12">
        <input
          defaultValue={account.name}
          placeholder="Display name"
          aria-label="Display name"
          className={cx(inputClass, "w-auto min-w-0 flex-1 sm:max-w-64")}
          onChange={(event) => saveName(event.target.value, 600)}
          onBlur={(event) => saveName(event.target.value, 0)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <fieldset className="flex gap-2" aria-label="Account color">
          {ACCOUNT_COLORS.map((color) => (
            <label key={color} className="cursor-pointer">
              <input
                type="radio"
                name={`color-${account.id}`}
                value={color}
                defaultChecked={account.color === color}
                onChange={() =>
                  colorSaver.submit({ intent: "update", accountId: account.id, color }, { method: "post" })
                }
                className="peer sr-only"
              />
              <span
                className="block size-5 rounded-full ring-zinc-900 ring-offset-2 ring-offset-white peer-checked:ring-2 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 dark:ring-white dark:ring-offset-zinc-950"
                style={{ background: color }}
              />
            </label>
          ))}
        </fieldset>
        <span aria-live="polite" className="ml-auto text-xs text-zinc-500">
          {saving ? "Saving…" : showSaved ? "Saved" : ""}
        </span>
      </div>
    </li>
  );
}

function Appearance() {
  const { palette, setPalette } = usePalette();
  const { mode, setMode } = useThemeMode();
  // The previews show each theme in its own font, so load all of them here.
  useEffect(() => PALETTES.forEach((p) => loadPaletteFont(p.id)), []);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Appearance</h2>
          <p className="text-sm text-zinc-500">The theme and the mode apply to this browser only.</p>
        </div>
        <div role="radiogroup" aria-label="Mode" className="flex shrink-0 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
          {(
            [
              { value: "light", label: "Light", Icon: Sun },
              { value: "dark", label: "Dark", Icon: Moon },
              { value: "system", label: "System", Icon: Desktop },
            ] satisfies { value: ThemeMode; label: string; Icon: typeof Sun }[]
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cx(
                "press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm",
                mode === value
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Theme">
        {PALETTES.map((p) => (
          // "relative" keeps the sr-only radio inside the scroll area. Without
          // it, the focus scrolls the overflow-hidden app frame and shows a gap.
          <label key={p.id} className="relative cursor-pointer">
            <input
              type="radio"
              name="palette"
              value={p.id}
              checked={palette === p.id}
              onChange={() => setPalette(p.id)}
              className="peer sr-only"
            />
            {/* data-palette gives the preview the colors and the font of its theme. */}
            <span
              data-palette={p.id}
              className="press block overflow-hidden rounded-xl bg-white font-sans text-zinc-900 ring-1 ring-zinc-200 peer-checked:ring-2 peer-checked:ring-accent-500 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
            >
              <span className="flex h-20 gap-1.5 p-1.5" aria-hidden>
                <span className="flex w-1/3 flex-col gap-1 rounded-md border border-(--sidebar-border) bg-(--sidebar) p-1">
                  <span className="h-1.5 w-3/4 rounded-full bg-accent-500" />
                  <span className="h-2.5 rounded bg-(--sidebar-selection)" />
                  <span className="h-1.5 w-2/3 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                  <span className="h-1.5 w-1/2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                </span>
                <span className="flex flex-1 flex-col gap-1 py-1">
                  <span className="rounded bg-accent-50 p-1 ring-1 ring-accent-500/60 ring-inset dark:bg-accent-500/10">
                    <span className="block h-1.5 w-3/4 rounded-full bg-zinc-800 dark:bg-zinc-200" />
                  </span>
                  <span className="px-1">
                    <span className="block h-1.5 w-2/3 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                  </span>
                  <span className="mt-auto ml-auto h-3 w-8 rounded bg-accent-600" />
                </span>
              </span>
              <span className="block border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block truncate text-xs text-zinc-500">{p.description}</span>
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
