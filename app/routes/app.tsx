import {
  Desktop,
  Gear,
  Keyboard,
  Moon,
  NotePencil,
  Plus,
  SidebarSimple,
  SignOut,
  Tray,
} from "~/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "@base-ui/react/drawer";
import { Outlet, redirect, useNavigate, useParams, useSubmit } from "react-router";
import type { Command } from "~/components/command-palette";
import { CommandPalette } from "~/components/command-palette";
import { ComposeWindow } from "~/components/composer";
import { useHotkeys } from "~/components/hotkeys";
import { MailProvider, useMail } from "~/components/mail-context";
import { ShortcutsDialog } from "~/components/shortcuts-dialog";
import {
  FOLDER_ICONS,
  SIDEBAR_SHORTCUT,
  Sidebar,
  SidebarButton,
  startPeek,
  stopPeek,
  toggleSidebar,
  useSidebarCollapsed,
} from "~/components/sidebar";
import { useTheme, useThemeMode } from "~/components/theme";
import { cx } from "~/components/ui";
import type { Folder } from "~/lib/mail";
import { FOLDER_LABELS, FOLDERS, isFolder } from "~/lib/mail";
import { toSummary } from "~/server/accounts.server";
import { getUser } from "~/server/auth.server";
import { userContext } from "~/server/context";
import { ServerTiming, timingContext } from "~/server/timing.server";
import { getDemoDataset } from "~/server/providers/demo.server";
import { DevDataToggle } from "~/components/dev-data-toggle";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/app";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ context }, next) => {
    const timing = new ServerTiming();
    context.set(timingContext, timing);
    const start = performance.now();
    const response = (await next()) as Response;
    // A streamed page ends later. This time is until the first byte.
    response.headers.append(
      "Server-Timing",
      [timing.header(), `response;dur=${(performance.now() - start).toFixed(1)}`].filter(Boolean).join(", "),
    );
    return response;
  },
  async ({ request, context }) => {
    // One query gives the user and the accounts, so the loaders do not ask again.
    const user = await context.get(timingContext)!.measure("user", () => getUser(request));
    if (!user) throw redirect("/welcome");
    context.set(userContext, user);
  },
];

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  const accounts = user.accounts.map(toSummary);
  if (accounts.length === 0) throw redirect("/welcome");
  const demo = accounts.find((a) => a.provider === "demo");
  // The worst-case data toggle is for development only.
  const devDataset = import.meta.env.DEV && demo ? getDemoDataset(demo.id) : null;
  // A demo workspace shows the demo company in the sidebar.
  return { accounts, devDataset, demo: user.demo };
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // A move to another folder or conversation does not change the accounts.
  // Form submissions and explicit reloads still load them again.
  if (!formMethod && currentUrl.href !== nextUrl.href) return false;
  return defaultShouldRevalidate;
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <MailProvider accounts={loaderData.accounts}>
      <Shell />
      {loaderData.devDataset && <DevDataToggle dataset={loaderData.devDataset} />}
    </MailProvider>
  );
}

const FOLDER_KEYS: Record<string, string> = {
  inbox: "G I",
  starred: "G S",
  sent: "G T",
  drafts: "G D",
  archive: "G A",
  spam: "G !",
  trash: "G #",
};

function Shell() {
  const params = useParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { accounts, openCompose, undoLast } = useMail();
  const { dark, toggle: toggleTheme } = useTheme();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const sidebarCollapsed = useSidebarCollapsed();

  const scope = params.scope ?? "all";
  const folder = isFolder(params.folder) ? params.folder : undefined;
  const go = (name: string) => navigate(`/mail/${scope}/${name}`);

  // "g 1" to "g 9" open the same folder in one account. "g 0" opens it for all accounts.
  const accountKeys = Object.fromEntries(
    accounts.length > 1
      ? [
          ["g 0", () => navigate(`/mail/all/${folder ?? "inbox"}`)],
          ...accounts.slice(0, 9).map((account, i) => [
            `g ${i + 1}`,
            () => navigate(`/mail/${account.id}/${folder ?? "inbox"}`),
          ]),
        ]
      : [],
  );

  useHotkeys({
    c: () => openCompose(),
    "mod+k": () => setPaletteOpen((open) => !open),
    "?": () => setShortcutsOpen((open) => !open),
    "g i": () => go("inbox"),
    "g s": () => go("starred"),
    "g t": () => go("sent"),
    "g d": () => go("drafts"),
    "g a": () => go("archive"),
    "g !": () => go("spam"),
    "g #": () => go("trash"),
    "g ,": () => navigate("/settings"),
    ...accountKeys,
    z: () => undoLast(),
    "mod+\\": () => toggleSidebar(),
  });

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "compose", label: "New message", group: "Write", hint: "C", icon: NotePencil, run: () => openCompose() },
      ...FOLDERS.map((name) => ({
        id: `go-${name}`,
        label: `${FOLDER_LABELS[name]}${accounts.length > 1 ? " (all accounts)" : ""}`,
        group: "Go to",
        hint: FOLDER_KEYS[name],
        icon: FOLDER_ICONS[name],
        run: () => navigate(`/mail/all/${name}`),
      })),
    ];
    if (accounts.length > 1) {
      for (const [i, account] of accounts.entries()) {
        list.push({
          id: `account-${account.id}`,
          label: `Inbox · ${account.email}`,
          group: "Go to",
          hint: i < 9 ? `G ${i + 1}` : undefined,
          icon: Tray,
          run: () => navigate(`/mail/${account.id}/inbox`),
        });
        list.push({
          id: `compose-${account.id}`,
          label: `New message from ${account.email}`,
          group: "Write",
          icon: NotePencil,
          run: () => openCompose({ accountId: account.id }),
        });
      }
    }
    list.push(
      { id: "add-account", label: "Add an email account", group: "Accounts", icon: Plus, run: () => navigate("/welcome") },
      { id: "settings", label: "Settings", group: "Accounts", hint: "G ,", icon: Gear, run: () => navigate("/settings") },
      {
        id: "sidebar",
        label: sidebarCollapsed ? "Show sidebar" : "Hide sidebar",
        group: "View",
        hint: SIDEBAR_SHORTCUT,
        icon: SidebarSimple,
        run: toggleSidebar,
      },
      { id: "theme", label: dark ? "Use light theme" : "Use dark theme", group: "View", icon: Moon, run: toggleTheme },
      ...(themeMode === "system"
        ? []
        : [{ id: "theme-system", label: "Use system theme", group: "View", icon: Desktop, run: () => setThemeMode("system") }]),
      { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", hint: "?", icon: Keyboard, run: () => setShortcutsOpen(true) },
      {
        id: "logout",
        label: "Sign out",
        group: "Accounts",
        icon: SignOut,
        run: () => submit(null, { method: "post", action: "/logout" }),
      },
    );
    return list;
  }, [accounts, dark, navigate, openCompose, setThemeMode, sidebarCollapsed, submit, themeMode, toggleTheme]);

  return (
    <div className="flex h-dvh overflow-hidden pt-[env(safe-area-inset-top)]">
      {/* iOS blurs the content under the status bar when no fixed element is
          at the top edge. This opaque strip is that element, so iOS shows its
          colour and not a blur. The headers have the page colour too. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-white dark:bg-zinc-950" />
      {/* On wide screens the sidebar collapses as in Colima GUI. The space
          it takes changes at once, and the content slides on a spring from
          its old position. The panel slides on the same spring, so its right
          edge stays on the left edge of the content. A
          pointer on the sidebar button or at the left edge brings a
          collapsed panel back over the content. */}
      <div
        data-sidebar-frame
        onPointerEnter={startPeek}
        onPointerLeave={stopPeek}
        className="group/sidebar hidden h-full w-[calc(var(--sidebar-width)+1rem)] shrink-0 md:block in-[.sidebar-collapsed]:w-0"
      >
        <SidebarButton />
        <div aria-hidden className="fixed inset-y-0 left-0 z-30 hidden w-2 in-[.sidebar-collapsed]:block" />
        <div
          className={cx(
            "fixed inset-y-0 left-0 z-40 transition-[translate] duration-(--sidebar-duration) ease-spring motion-reduce:transition-none",
            "in-[.sidebar-collapsed]:-translate-x-full in-[.sidebar-peek]:translate-x-0",
            // Keyboard focus keeps it out. A click does not, because the
            // link keeps the focus after the pointer leaves.
            "in-[.sidebar-collapsed]:group-has-focus-visible/sidebar:translate-x-0",
            "in-[.sidebar-collapsed]:[&_nav]:shadow-2xl in-[.sidebar-collapsed]:[&_nav]:shadow-zinc-950/20",
          )}
        >
          <Sidebar
            resizable
            scope={scope}
            folder={folder}
            dark={dark}
            onToggleTheme={toggleTheme}
            onShowShortcuts={() => setShortcutsOpen(true)}
          />
        </div>
      </div>
      <NavDrawer
        scope={scope}
        folder={folder}
        threadOpen={Boolean(params.threadId)}
        dark={dark}
        onToggleTheme={toggleTheme}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <main data-sidebar-content className="flex min-w-0 flex-1">
        <Outlet />
      </main>
      <ComposeWindow />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

/**
 * On small screens the sidebar is a drawer. Swipe right from the left edge to
 * open it. Swipe left or tap outside it to close it. A tap on a row in the
 * drawer does not close it. A tap on "New message" closes it. When a conversation is open, the same swipe
 * goes back to the list, so the swipe area is off. The open state is here and
 * not in the shell, so an open or a close does not render the message list
 * again while the drawer moves. The drawer stays mounted for the same reason.
 */
function NavDrawer({
  scope,
  folder,
  threadOpen,
  dark,
  onToggleTheme,
  onShowShortcuts,
}: {
  scope: string;
  folder?: Folder;
  threadOpen: boolean;
  dark: boolean;
  onToggleTheme(): void;
  onShowShortcuts(): void;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const { openCompose } = useMail();

  // "New message" in the drawer closes the drawer first. The composer opens
  // after the drawer is closed, so the keyboard does not show over the drawer.
  const composeAfterClose = useRef(false);
  function compose() {
    composeAfterClose.current = true;
    setNavOpen(false);
  }
  function onOpenChangeComplete(open: boolean) {
    if (open || !composeAfterClose.current) return;
    composeAfterClose.current = false;
    openCompose();
  }

  // The list header opens the sidebar drawer on small screens.
  useEffect(() => {
    const open = () => setNavOpen(true);
    window.addEventListener("mail:open-nav", open);
    return () => window.removeEventListener("mail:open-nav", open);
  }, []);

  // Safari has its own swipe back from the left edge, and it goes back in the
  // history. A touch on the swipe area must open the drawer, so the touch
  // stops the Safari gesture. The drawer ignores a touch that is prevented,
  // so the touch is prevented on the document, after the React listener
  // there. The blocking listener is on the swipe area only, so a touch on the
  // rest of the page does not wait for it.
  const swipeArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const area = swipeArea.current;
    if (!area) return;
    const prevent = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const onStart = () => document.addEventListener("touchstart", prevent, { once: true, passive: false });
    area.addEventListener("touchstart", onStart, { passive: false });
    return () => area.removeEventListener("touchstart", onStart);
  }, []);

  return (
    <Drawer.Root
      open={navOpen}
      onOpenChange={setNavOpen}
      onOpenChangeComplete={onOpenChangeComplete}
      swipeDirection="left"
    >
      <Drawer.SwipeArea
        ref={swipeArea}
        disabled={threadOpen}
        className="fixed inset-y-0 left-0 z-30 w-5 md:hidden"
      />
      <Drawer.Portal keepMounted>
        <Drawer.Backdrop className="fixed inset-0 z-40 min-h-dvh bg-zinc-950 opacity-[calc(0.4*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[400ms] ease-(--ease-drawer) data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 md:hidden" />
        <Drawer.Viewport className="fixed inset-0 z-40 flex items-stretch justify-start md:hidden">
          <Drawer.Popup className="h-full w-64 bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-[400ms] ease-(--ease-drawer) data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)] data-ending-style:duration-[calc(var(--drawer-swipe-strength)*300ms)] data-swiping:select-none dark:bg-zinc-950">
            <Drawer.Title className="sr-only">Folders and accounts</Drawer.Title>
            <Sidebar
              drawer
              onCompose={compose}
              scope={scope}
              folder={folder}
              dark={dark}
              onToggleTheme={onToggleTheme}
              onShowShortcuts={onShowShortcuts}
            />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
