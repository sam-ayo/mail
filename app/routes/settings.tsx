import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bell, BellSlash, CaretLeft, Copy, Desktop, Moon, Plus, SignOut, Sun, Trash, Warning } from "~/components/icons";
import { data, Form, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { removeAccountPrompt, useConfirm } from "~/components/confirm-dialog";
import { reconnectUrl } from "~/components/sidebar";
import { loadPaletteFont, PALETTES, usePalette, useThemeMode, type ThemeMode } from "~/components/theme";
import { AccountIcon, Button, PROVIDER_NAMES, cx, inputClass } from "~/components/ui";
import { ACCOUNT_COLORS, shownProvider, type AccountSummary } from "~/lib/mail";
import { deleteAccount, listAccounts, toSummary, updateAccountProfile } from "~/server/accounts.server";
import type { MailScope } from "~/lib/agents";
import { disconnectAgent, listAgentConnections, MCP_RESOURCE, type AgentConnection } from "~/server/agent-auth.server";
import { userContext } from "~/server/context";
import { closeImapConnection } from "~/server/providers/imap.server";
import { resetDemoAccount } from "~/server/providers/demo.server";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => [{ title: "Settings · mail" }];

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  const [accounts, agents] = await Promise.all([listAccounts(user.id), listAgentConnections(user.id)]);
  return { accounts: accounts.map(toSummary), agents, mcpUrl: MCP_RESOURCE };
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
    case "disconnectAgent":
      await disconnectAgent(user.id, String(form.get("clientId") ?? ""));
      return { disconnected: true };
    default:
      throw data("Unknown action", { status: 400 });
  }
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-2 pb-10 md:px-6 md:pt-10">
        {/* On a phone, a back button as in iOS. */}
        <Link
          to="/mail"
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

          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {loaderData.accounts.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </ul>
        </section>

        <Appearance />

        <Notifications />

        <AiAgents agents={loaderData.agents} mcpUrl={loaderData.mcpUrl} />

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
          className={cx(inputClass, "w-full sm:w-auto sm:min-w-0 sm:flex-1 sm:max-w-64")}
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
  async function copy() {
    await navigator.clipboard.writeText(mcpUrl);
    toast.success("Copied the MCP server URL");
  }

  return (
    <section className="mt-10">
      <h2 className="font-semibold">AI agents</h2>
      <p className="mb-3 text-sm text-zinc-500">
        Connect Claude, ChatGPT, Cursor, or another MCP client to the email in all your accounts. Add this URL as a
        custom connector or remote MCP server. The agent asks you to sign in and allow access.
      </p>
      <div className="flex items-center gap-2">
        <input readOnly value={mcpUrl} aria-label="MCP server URL" className={cx(inputClass, "font-mono text-xs")} />
        <Button className="shrink-0" onClick={copy}>
          <Copy className="size-4" /> Copy
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
