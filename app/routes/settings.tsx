import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, BellSlash, CaretLeft, CaretRight, Check, Copy, Desktop, Moon, Plus, SignOut, Sun, Trash, Warning, X } from "~/components/icons";
import { data, Form, Link, useFetcher, useFetchers, useSubmit } from "react-router";
import { toast } from "sonner";
import { removeAccountPrompt, useConfirm } from "~/components/confirm-dialog";
import { reconnectUrl } from "~/components/sidebar";
import { loadPaletteFont, PALETTES, usePalette, useThemeMode, type ThemeMode } from "~/components/theme";
import { AccountIcon, Avatar, Button, IconButton, PROVIDER_NAMES, cx, inputClass } from "~/components/ui";
import { ACCOUNT_COLORS, shownProvider, suggestImportantSenders, type AccountSummary, type KnownSender } from "~/lib/mail";
import {
  addCustomColor,
  deleteAccount,
  listAccounts,
  listCustomColors,
  removeCustomColor,
  toSummary,
  updateAccountProfile,
} from "~/server/accounts.server";
import type { MailScope } from "~/lib/agents";
import { disconnectAgent, listAgentConnections, MCP_RESOURCE, type AgentConnection } from "~/server/agent-connections.server";
import { userContext } from "~/server/context";
import { closeImapConnection } from "~/server/providers/imap.server";
import { resetDemoAccount } from "~/server/providers/demo.server";
import {
  addImportantSender,
  aiSortingConfigured,
  aiSortingOn,
  listImportantSenders,
  removeImportantSender,
  setAiSorting,
} from "~/server/triage.server";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => [{ title: "Settings · mail" }];

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  const [accounts, customColors, agents, aiSorting, importantSenders] = await Promise.all([
    listAccounts(user.id),
    listCustomColors(user.id),
    listAgentConnections(user.id),
    aiSortingOn(user.id),
    aiSortingConfigured ? listImportantSenders(user.id) : [],
  ]);
  return {
    accounts: accounts.map(toSummary),
    customColors,
    agents,
    mcpUrl: MCP_RESOURCE,
    aiSorting: aiSortingConfigured ? aiSorting : null,
    importantSenders,
  };
}

/** Any color from the picker is valid, not only the default colors. */
function validColor(value: FormDataEntryValue | null) {
  const color = String(value ?? "");
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined;
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(userContext)!;
  const form = await request.formData();
  const accountId = String(form.get("accountId") ?? "");
  switch (form.get("intent")) {
    case "update": {
      // Each autosave sends only the field that changed.
      const name = form.get("name");
      const color = validColor(form.get("color"));
      await updateAccountProfile(user.id, accountId, {
        name: name == null ? undefined : String(name).trim(),
        color,
      });
      // A color from the picker becomes a swatch for all accounts.
      if (color) await addCustomColor(user.id, color);
      return { saved: accountId };
    }
    case "removeColor": {
      const color = validColor(form.get("color"));
      if (color) await removeCustomColor(user.id, color);
      return { removedColor: color };
    }
    case "remove":
      await deleteAccount(user.id, accountId);
      closeImapConnection(accountId);
      resetDemoAccount(accountId);
      return { removed: accountId };
    case "disconnectAgent":
      await disconnectAgent(user.id, String(form.get("clientId") ?? ""));
      return { disconnected: true };
    case "aiSorting":
      await setAiSorting(user.id, form.get("on") === "true");
      return { aiSorting: true };
    case "addImportantSender": {
      const pattern = await addImportantSender(user.id, String(form.get("sender") ?? ""));
      return pattern ? { importantSender: pattern } : { importantSenderError: "Enter an address or a domain." };
    }
    case "removeImportantSender":
      await removeImportantSender(user.id, String(form.get("pattern") ?? ""));
      return { removedImportantSender: true };
    default:
      throw data("Unknown action", { status: 400 });
  }
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pt-2 pb-10 md:px-6 md:pt-10">
        {/* On a phone, a back button as in iOS. */}
        <Link
          to="/mail/all/inbox"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 max-md:press max-md:-ml-1.5 max-md:mb-2 max-md:gap-0 max-md:py-1.5 max-md:text-[17px] max-md:text-accent-600 dark:hover:text-zinc-100 max-md:dark:text-accent-400"
        >
          <ArrowLeft className="size-4 max-md:hidden" />
          <CaretLeft className="size-6 md:hidden" />
          <span className="max-md:hidden">Back to mail</span>
          <span className="md:hidden">Mail</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight max-md:text-3xl max-md:font-bold">Settings</h1>

        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Email accounts</h2>
              <p className="text-sm text-zinc-500">
                The display name shows as the sender name on mail you send.
              </p>
            </div>
            <Link
              to="/welcome"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-accent-700"
            >
              <Plus className="size-4" /> Add account
            </Link>
          </div>

          <Accounts accounts={loaderData.accounts} customColors={loaderData.customColors} />
        </section>

        <Appearance />

        <Notifications />

        <AiAgents agents={loaderData.agents} mcpUrl={loaderData.mcpUrl} />

        {loaderData.aiSorting !== null && (
          <AiSorting on={loaderData.aiSorting} importantSenders={loaderData.importantSenders} />
        )}

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

/** The fetcher key of the color save of an account. The list reads it to show a new color before the save ends. */
const colorKey = (accountId: string) => `account-color-${accountId}`;

/** A list of the accounts, and the settings of the selected account next to it. */
function Accounts({ accounts, customColors }: { accounts: AccountSummary[]; customColors: string[] }) {
  const [selectedId, setSelectedId] = useState(accounts[0]?.id);
  // A new color shows at once, before the save ends and the loader has it.
  const [addedColors, setAddedColors] = useState<string[]>([]);
  const submit = useSubmit();
  const removingColors = useFetchers()
    .filter((fetcher) => fetcher.formData?.get("intent") === "removeColor")
    .map((fetcher) => String(fetcher.formData!.get("color")));
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];

  if (!selected) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
        No accounts are connected.
      </p>
    );
  }

  const savedColors = [...new Set([...customColors, ...addedColors])].filter(
    (color) => !ACCOUNT_COLORS.includes(color) && !removingColors.includes(color),
  );

  function removeColor(color: string) {
    setAddedColors((colors) => colors.filter((c) => c !== color));
    // Each removal has its own fetcher, so a second removal does not cancel the first.
    submit(
      { intent: "removeColor", color },
      { method: "post", navigate: false, fetcherKey: `remove-color-${color}` },
    );
  }

  return (
    <div className="grid overflow-hidden rounded-xl border border-zinc-200 sm:grid-cols-[16rem_1fr] dark:border-zinc-800">
      <ul className="border-b border-zinc-200 bg-(--sidebar) p-1.5 sm:border-r sm:border-b-0 dark:border-zinc-800">
        {accounts.map((account) => (
          <AccountListItem
            key={account.id}
            account={account}
            selected={account.id === selected.id}
            onSelect={() => setSelectedId(account.id)}
          />
        ))}
      </ul>
      {/* The key gives each account its own name field and its own fetchers. */}
      <AccountDetail
        key={selected.id}
        account={selected}
        savedColors={savedColors}
        onAddColor={(color) => setAddedColors((colors) => (colors.includes(color) ? colors : [...colors, color]))}
        onRemoveColor={removeColor}
      />
    </div>
  );
}

function AccountListItem({
  account,
  selected,
  onSelect,
}: {
  account: AccountSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const colorSaver = useFetcher<typeof action>({ key: colorKey(account.id) });
  const color = String(colorSaver.formData?.get("color") ?? account.color);
  return (
    <li>
      <button
        type="button"
        aria-current={selected}
        onClick={onSelect}
        className={cx(
          "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left",
          selected ? "bg-white shadow-xs dark:bg-zinc-800" : "hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50",
        )}
      >
        <LogoDot
          account={account}
          color={color}
          ring={
            selected
              ? "ring-white dark:ring-zinc-800"
              : "ring-(--sidebar) group-hover:ring-[color-mix(in_oklab,var(--color-zinc-200)_50%,var(--sidebar))] dark:group-hover:ring-[color-mix(in_oklab,var(--color-zinc-800)_50%,var(--sidebar))]"
          }
        />
        <span className="min-w-0 flex-1 truncate text-sm">{account.email}</span>
        {account.status === "reauth_required" && <Warning className="size-3.5 shrink-0 text-amber-600" />}
        <CaretRight className="size-3.5 shrink-0 text-zinc-400" />
      </button>
    </li>
  );
}

/**
 * The logo with the account color as a dot on its corner, as in the sidebar.
 * The ring has the color behind the logo, so it cuts the logo.
 */
function LogoDot({
  account,
  color,
  ring,
  large,
}: {
  account: AccountSummary;
  color: string;
  ring: string;
  large?: boolean;
}) {
  return (
    <span className="relative flex shrink-0" title={PROVIDER_NAMES[shownProvider(account)]}>
      <AccountIcon account={account} className={cx("text-zinc-500", large ? "size-10" : "size-4")} />
      <span
        className={cx(
          "absolute rounded-full",
          large ? "-right-1 -bottom-1 size-3.5 ring-[3px]" : "-right-0.5 -bottom-0.5 size-2 ring-[1.5px]",
          ring,
        )}
        style={{ background: color }}
      />
    </span>
  );
}

function AccountDetail({
  account,
  savedColors,
  onAddColor,
  onRemoveColor,
}: {
  account: AccountSummary;
  savedColors: string[];
  onAddColor: (color: string) => void;
  onRemoveColor: (color: string) => void;
}) {
  // The name and the color save on separate fetchers, so one save does not cancel the other.
  const nameSaver = useFetcher<typeof action>();
  const colorSaver = useFetcher<typeof action>({ key: colorKey(account.id) });
  const remover = useFetcher<typeof action>();
  const removing = remover.state !== "idle";
  const confirm = useConfirm();
  const [name, setName] = useState(account.name);
  const lastName = useRef(account.name);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showSaved, setShowSaved] = useState(false);
  // The color shows on the account while the person moves in the color picker. It saves when the picker closes.
  const [previewColor, setPreviewColor] = useState<string>();
  const color = previewColor ?? String(colorSaver.formData?.get("color") ?? account.color);

  const saving = nameSaver.state !== "idle" || colorSaver.state !== "idle";
  // The color of the account stays a swatch after the person removes it from the added colors.
  const swatches = [...new Set([...ACCOUNT_COLORS, ...savedColors, account.color])];

  // The name saves after a short pause in typing, or at once when the field loses focus.
  function saveName(value: string, delay: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = value.trim();
      if (trimmed === lastName.current) return;
      lastName.current = trimmed;
      nameSaver.submit({ intent: "update", accountId: account.id, name: trimmed }, { method: "post" });
    }, delay);
  }

  function saveColor(value: string) {
    setPreviewColor(undefined);
    if (value === account.color && colorSaver.formData == null) return;
    colorSaver.submit({ intent: "update", accountId: account.id, color: value }, { method: "post" });
  }

  // iOS Safari sends the native change event on each move in the picker, not only when the picker closes.
  // The color saves after a short pause, and one picker session keeps one added color, not one for each pause.
  const pickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pickedColor = useRef<string>(undefined);
  const commitPick = useRef<(value: string) => void>(undefined);
  commitPick.current = (value) => {
    if (pickedColor.current && pickedColor.current !== value) {
      onRemoveColor(pickedColor.current);
      pickedColor.current = undefined;
    }
    if (!swatches.includes(value)) pickedColor.current = value;
    onAddColor(value);
    saveColor(value);
  };

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(pickTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (saving || (nameSaver.data == null && colorSaver.data == null)) return;
    setShowSaved(true);
    const hide = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(hide);
  }, [saving, nameSaver.data, colorSaver.data]);

  return (
    <div className={cx("flex min-w-0 flex-col gap-6 p-6", removing && "opacity-50")}>
      <div className="flex items-center gap-4">
        <LogoDot account={account} color={color} ring="ring-white dark:ring-zinc-950" large />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{name.trim() || account.email}</p>
          <p className="truncate text-sm text-zinc-500">
            {account.email} · {PROVIDER_NAMES[shownProvider(account)]}
          </p>
        </div>
        {account.status === "reauth_required" && (
          <Link
            to={reconnectUrl(account)}
            reloadDocument={account.provider !== "imap"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <Warning className="size-3.5" /> Sign in again
          </Link>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Display name</span>
        <input
          value={name}
          placeholder="Display name"
          className={cx(inputClass, "max-w-80")}
          onChange={(event) => {
            setName(event.target.value);
            saveName(event.target.value, 600);
          }}
          onBlur={(event) => saveName(event.target.value, 0)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Color</legend>
        <div className="flex flex-wrap items-center gap-2 pointer-coarse:gap-3">
          {swatches.map((swatch) => (
            <span key={swatch} className="group/swatch relative flex">
              <label title={swatch} className="cursor-pointer">
                <input
                  type="radio"
                  name={`color-${account.id}`}
                  value={swatch}
                  checked={color === swatch}
                  onChange={() => saveColor(swatch)}
                  className="peer sr-only"
                />
                <span
                  className="block size-5 rounded-full ring-zinc-900 ring-offset-2 ring-offset-white peer-checked:ring-2 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 dark:ring-white dark:ring-offset-zinc-950"
                  style={{ background: swatch }}
                />
              </label>
              {savedColors.includes(swatch) && (
                <button
                  type="button"
                  aria-label={`Remove the color ${swatch}`}
                  title="Remove the color"
                  onClick={() => onRemoveColor(swatch)}
                  // A touch screen has no hover, so the button always shows there, with a larger area to tap.
                  className="absolute -top-1.5 -right-1.5 grid size-3.5 place-items-center rounded-full bg-zinc-700 text-white opacity-0 group-hover/swatch:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-[''] dark:bg-zinc-300 dark:text-zinc-900"
                >
                  <X className="size-2.5" />
                </button>
              )}
            </span>
          ))}
          <label
            title="Add a color"
            className="press relative grid size-5 cursor-pointer place-items-center rounded-full border border-dashed border-zinc-300 text-zinc-500 focus-within:ring-2 focus-within:ring-accent-500 hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
          >
            <Plus className="size-3" />
            <input
              type="color"
              aria-label="Add a color"
              value={color}
              onChange={(event) => setPreviewColor(event.target.value)}
              // A new picker session starts with no added color.
              onClick={() => (pickedColor.current = undefined)}
              // React's onChange runs on each move in the picker. The native change event runs when the picker closes,
              // and on iOS also on each move.
              ref={(input) => {
                if (!input) return;
                input.onchange = () => {
                  const value = input.value.toLowerCase();
                  setPreviewColor(value);
                  clearTimeout(pickTimer.current);
                  pickTimer.current = setTimeout(() => commitPick.current?.(value), 700);
                };
              }}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <remover.Form method="post">
          <input type="hidden" name="accountId" value={account.id} />
          <button
            name="intent"
            value="remove"
            disabled={removing}
            className="press -ml-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
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
        <span aria-live="polite" className="text-xs text-zinc-500">
          {saving ? "Saving…" : showSaved ? "Saved" : ""}
        </span>
      </div>
    </div>
  );
}

function Appearance() {
  const { palette, setPalette } = usePalette();
  const { mode, setMode } = useThemeMode();
  // The previews show each theme in its own font, so load all of them here.
  useEffect(() => PALETTES.forEach((p) => loadPaletteFont(p.id)), []);

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
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

      <fieldset className="grid grid-cols-4 gap-3 sm:grid-cols-7" aria-label="Theme">
        {PALETTES.map((p) => (
          // "relative" keeps the sr-only radio inside the scroll area. Without
          // it, the focus scrolls the overflow-hidden app frame and shows a gap.
          <label key={p.id} title={p.description} className="group relative flex cursor-pointer flex-col items-center gap-1.5 text-xs">
            <input
              type="radio"
              name="palette"
              value={p.id}
              checked={palette === p.id}
              onChange={() => setPalette(p.id)}
              className="peer sr-only"
            />
            {/* data-palette gives the tile the sidebar fill, the accent, and the font of its theme. */}
            <span
              data-palette={p.id}
              className={cx(
                "press relative grid aspect-square w-full place-items-center rounded-xl bg-(--sidebar) font-sans text-zinc-900 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 dark:text-zinc-100",
                palette === p.id
                  ? "ring-2 ring-accent-500"
                  : "ring-1 ring-(--sidebar-border) group-hover:ring-zinc-300 dark:group-hover:ring-zinc-700",
              )}
              aria-hidden
            >
              <span className="text-2xl font-medium tracking-tight">Aa</span>
              <span className="absolute inset-x-3 bottom-2.5 flex gap-1">
                <span className="h-1.5 flex-1 rounded-full bg-accent-500" />
                <span className="h-1.5 w-1/4 rounded-full bg-zinc-300 dark:bg-zinc-700" />
              </span>
            </span>
            <span className="text-zinc-500 peer-checked:font-medium peer-checked:text-zinc-900 dark:peer-checked:text-zinc-100">{p.label}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

type PushState = "loading" | "unsupported" | "install" | "denied" | "off" | "on";

async function serviceWorker() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
}

function readPushState(): Promise<PushState> | PushState {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // Safari on iPhone and iPad has push only for apps on the Home Screen.
    const ios = /iPhone|iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return ios ? "install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.pushManager.getSubscription())
    .then((subscription) => (subscription && Notification.permission === "granted" ? "on" : "off"));
}

/** The push key is in base64url. Safari needs it as bytes. */
function keyBytes(key: string) {
  const base64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function Notifications() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  // Safari allows the subscription only while it handles the click. Thus the
  // service worker and the key are ready before the click.
  const ready = useRef<Promise<{ registration: ServiceWorkerRegistration; publicKey: string | null }>>(undefined);

  useEffect(() => {
    Promise.resolve(readPushState()).then(
      (value) => {
        setState(value);
        if (value !== "off" && value !== "on") return;
        ready.current = Promise.all([
          serviceWorker().then(() => navigator.serviceWorker.ready),
          fetch("/api/push").then((response) => response.json() as Promise<{ publicKey: string | null }>),
        ]).then(([registration, { publicKey }]) => ({ registration, publicKey }));
        // A failure shows when the person clicks.
        ready.current.catch(() => {});
      },
      () => setState("unsupported"),
    );
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const { registration, publicKey } = await ready.current!;
      if (!publicKey) throw new Error("The server cannot send notifications yet");
      // The subscription asks for permission if necessary.
      const subscription = await registration.pushManager
        .subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
        .catch((error) => {
          if (Notification.permission !== "granted") return null;
          throw error;
        });
      if (!subscription) {
        setState(Notification.permission === "denied" ? "denied" : "off");
        return;
      }
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("The server did not save the subscription");
      setState("on");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notifications did not turn on");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const subscription = await (await serviceWorker()).pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      toast.error("Notifications did not turn off");
    } finally {
      setBusy(false);
    }
  }

  const description: Record<PushState, string> = {
    loading: "Get a notification on this device when new mail comes to your inbox.",
    off: "Get a notification on this device when new mail comes to your inbox.",
    on: "This device gets a notification when new mail comes to your inbox.",
    denied: "This browser blocks notifications from mail. Allow them in the browser or system settings.",
    install: "On iPhone and iPad, add mail to your Home Screen first. Tap Share, then Add to Home Screen.",
    unsupported: "This browser cannot show notifications.",
  };

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h2 className="font-semibold">Notifications</h2>
          <p className="text-sm text-zinc-500">{description[state]}</p>
        </div>
        {state === "on" ? (
          <Button className="shrink-0" disabled={busy} onClick={turnOff}>
            <BellSlash className="size-4" /> Turn off
          </Button>
        ) : (
          (state === "off" || state === "loading") && (
            <Button className="shrink-0" variant="primary" disabled={busy || state === "loading"} onClick={turnOn}>
              <Bell className="size-4" /> Turn on
            </Button>
          )
        )}
      </div>
    </section>
  );
}

const SCOPE_LABELS: Record<MailScope, string> = { "mail:read": "Read", "mail:write": "Organize", "mail:send": "Send" };

function AiAgents({ agents, mcpUrl }: { agents: AgentConnection[]; mcpUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  async function copy() {
    await navigator.clipboard.writeText(mcpUrl);
    toast.success("Copied the MCP server URL");
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="mt-10">
      <h2 className="font-semibold">AI agents</h2>
      <p className="mb-3 text-sm text-zinc-500">
        Let Claude, ChatGPT, or another AI app use your email. Add this URL to the app as a connector.
      </p>
      <div className="flex items-center gap-2">
        <input readOnly value={mcpUrl} aria-label="MCP server URL" className={cx(inputClass, "font-mono text-xs")} />
        <Button className="shrink-0" onClick={copy}>
          <CopyState copied={copied} />
        </Button>
      </div>
      {agents.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {agents.map((agent) => (
            <AgentRow key={agent.clientId} agent={agent} />
          ))}
        </ul>
      )}
    </section>
  );
}

// Both states stay in the same grid cell, so the button keeps its width.
// The blur blends the two icons into one change.
const SWAP = "[grid-area:1/1] transition-[opacity,scale,filter] duration-200 ease-out motion-reduce:scale-100! motion-reduce:blur-none!";

function CopyState({ copied }: { copied: boolean }) {
  const shown = "opacity-100 scale-100 blur-none";
  const hidden = "opacity-0 scale-[0.6] blur-[2px]";
  return (
    <>
      <span className="grid size-4 place-items-center" aria-hidden>
        <Copy className={cx("size-4", SWAP, copied ? hidden : shown)} />
        <Check className={cx("size-4", SWAP, copied ? shown : hidden)} />
      </span>
      <span className="grid">
        <span className={cx(SWAP, copied ? "opacity-0" : "opacity-100")} aria-hidden={copied}>Copy</span>
        <span className={cx(SWAP, copied ? "opacity-100" : "opacity-0")} aria-hidden={!copied}>Copied</span>
      </span>
    </>
  );
}

function AgentRow({ agent }: { agent: AgentConnection }) {
  const fetcher = useFetcher<typeof action>();
  const scopes = agent.scopes.map((scope) => SCOPE_LABELS[scope]).join(", ");
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{agent.name}</p>
        <p className="truncate text-xs text-zinc-500">
          {[agent.site, scopes, `Connected ${new Date(agent.connectedAt).toLocaleDateString()}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <Button
        className="shrink-0"
        disabled={fetcher.state !== "idle"}
        onClick={() => fetcher.submit({ intent: "disconnectAgent", clientId: agent.clientId }, { method: "post" })}
      >
        Disconnect
      </Button>
    </li>
  );
}

/**
 * AI sorting puts promotions in their own inbox tab. It is on by default. The
 * server sends the start of each new email to TypeSafe, so the person can turn it off.
 */
function AiSorting({ on, importantSenders }: { on: boolean; importantSenders: string[] }) {
  const fetcher = useFetcher<typeof action>();
  const shown = fetcher.formData ? fetcher.formData.get("on") === "true" : on;
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h2 className="font-semibold">AI sorting</h2>
          <p className="text-sm text-zinc-500">
            {shown ? "New mail goes to Important or Promotions." : "Put promotions in their own tab."}
          </p>
        </div>
        <Button
          className="shrink-0"
          variant={shown ? undefined : "primary"}
          disabled={fetcher.state !== "idle"}
          onClick={() => fetcher.submit({ intent: "aiSorting", on: String(!shown) }, { method: "post" })}
        >
          {shown ? "Turn off" : "Turn on"}
        </Button>
      </div>
      <ImportantSenders patterns={importantSenders} />
    </section>
  );
}

/**
 * Senders whose mail always goes to Important. The list has priority over
 * Jev, and stays when the person turns AI sorting off.
 */
function ImportantSenders({ patterns }: { patterns: string[] }) {
  const fetcher = useFetcher<typeof action>();
  const [text, setText] = useState("");
  const error = fetcher.data && "importantSenderError" in fetcher.data ? fetcher.data.importantSenderError : undefined;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "importantSender" in fetcher.data) setText("");
  }, [fetcher.state, fetcher.data]);

  // The people in the recent mail of the person load once, when the field gets
  // the focus. Then each key filters them at once.
  const known = useFetcher<{ senders: KnownSender[] }>();
  function loadKnown() {
    if (known.state === "idle" && !known.data) known.load("/api/important-senders");
  }
  // A mail search for the text finds people in older mail. It runs after a short pause in the typing.
  const searched = useFetcher<{ senders: KnownSender[] }>();
  const query = text.trim();
  useEffect(() => {
    if (query.replace(/^@/, "").length < 2) return;
    const timer = setTimeout(() => searched.load(`/api/important-senders?q=${encodeURIComponent(query)}`), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const found = useMemo(() => {
    // Both lists can have a person. The larger count is the better one.
    const counts = new Map<string, number>();
    for (const { email, count } of [...(known.data?.senders ?? []), ...(searched.data?.senders ?? [])]) {
      counts.set(email, Math.max(counts.get(email) ?? 0, count));
    }
    const senders = [...counts].map(([email, count]) => ({ email, count }));
    return suggestImportantSenders(senders, patterns, text);
  }, [known.data, searched.data, patterns, text]);

  // The first suggestion that starts with the text completes it in the field.
  // A domain also matches without its "@", so "lin" completes to "@linkedin.com".
  const lower = text.toLowerCase();
  const completion = lower
    ? found.flatMap((item) => {
        const form = [item, item.replace(/^@/, "")].find((f) => f.startsWith(lower) && f.length > lower.length);
        return form ? [{ item, rest: form.slice(lower.length) }] : [];
      })[0]
    : undefined;
  // The completed suggestion comes first in the list too.
  const items = completion ? [completion.item, ...found.filter((i) => i !== completion.item)] : found;
  const [highlighted, setHighlighted] = useState<string>();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function add(sender: string) {
    fetcher.submit({ intent: "addImportantSender", sender }, { method: "post" });
  }

  /** Tab or → takes the completion. Return adds it, if no suggestion has the keyboard highlight. */
  function completeOnKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!completion) return;
    const input = event.currentTarget;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    if ((event.key === "Tab" && !event.shiftKey) || (event.key === "ArrowRight" && atEnd)) {
      event.preventDefault();
      setText(completion.item);
    } else if (event.key === "Enter" && !highlighted) {
      event.preventDefault();
      add(completion.item);
    }
  }

  return (
    <div className="mt-5">
      <h3 className="text-sm font-medium">Always important</h3>
      <p className="mb-3 text-sm text-zinc-500">
        Mail from these senders always goes to Important.
      </p>
      <fetcher.Form method="post" className="flex gap-2">
        <input type="hidden" name="intent" value="addImportantSender" />
        {/* A click on a suggestion adds it at once. */}
        <Autocomplete.Root
          items={items}
          value={text}
          onValueChange={setText}
          onItemHighlighted={(item) => setHighlighted(item)}
          submitOnItemClick
        >
          <div className="relative min-w-0 flex-1">
            <Autocomplete.Input
              name="sender"
              required
              maxLength={320}
              spellCheck={false}
              placeholder="Address or @domain"
              aria-label="Address or domain"
              aria-invalid={error ? true : undefined}
              ref={inputRef}
              onKeyDown={completeOnKey}
              onFocus={() => {
                setFocused(true);
                loadKnown();
              }}
              onBlur={() => setFocused(false)}
              className={inputClass}
            />
            {/* The rest of the completion shows in grey after the text. It has the padding and border of the input. */}
            {/* A tap or a click on the grey text takes the completion. It does not take the focus from the input. */}
            {completion && focused && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 flex overflow-hidden border border-transparent px-3 py-2 text-sm whitespace-pre pointer-coarse:text-[16px]"
              >
                <span className="invisible shrink-0">{text}</span>
                <span
                  className="pointer-events-auto flex-1 cursor-pointer text-zinc-400 dark:text-zinc-500"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setText(completion.item);
                    inputRef.current?.focus();
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {completion.rest}
                </span>
              </div>
            )}
          </div>
          {items.length > 0 && (
            <Autocomplete.Portal>
              <Autocomplete.Positioner sideOffset={4} align="start" className="z-[60] outline-none">
                <Autocomplete.Popup className="max-h-72 w-(--anchor-width) overflow-y-auto rounded-xl bg-white p-1 text-sm shadow-xl ring-1 ring-black/5 outline-none dark:bg-zinc-900 dark:ring-white/10">
                  <Autocomplete.List>
                    {(item: string) => (
                      <Autocomplete.Item
                        key={item}
                        value={item}
                        className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-zinc-700 outline-none select-none data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800"
                      >
                        <SenderLabel pattern={item} />
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.List>
                </Autocomplete.Popup>
              </Autocomplete.Positioner>
            </Autocomplete.Portal>
          )}
        </Autocomplete.Root>
        <Button type="submit" className="shrink-0" disabled={fetcher.state !== "idle"}>
          <Plus className="size-4" /> Add
        </Button>
      </fetcher.Form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {patterns.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {patterns.map((pattern) => (
            <ImportantSenderRow key={pattern} pattern={pattern} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The logo and the text of an address or a domain in the list of important senders. */
function SenderLabel({ pattern }: { pattern: string }) {
  const domain = pattern.startsWith("@") ? pattern.slice(1) : undefined;
  return (
    <>
      <Avatar email={domain ?? pattern} domain={domain} size="sm" />
      <span className="min-w-0 truncate">{pattern}</span>
      {domain && <span className="ml-auto shrink-0 pl-2 text-xs text-zinc-500">All senders</span>}
    </>
  );
}

function ImportantSenderRow({ pattern }: { pattern: string }) {
  const fetcher = useFetcher<typeof action>();
  if (fetcher.formData) return null;
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <SenderLabel pattern={pattern} />
      </span>
      <IconButton
        label={`Remove ${pattern}`}
        onClick={() => fetcher.submit({ intent: "removeImportantSender", pattern }, { method: "post" })}
      >
        <X className="size-4" />
      </IconButton>
    </li>
  );
}
