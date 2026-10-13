import {
  Archive,
  ArrowSquareOut,
  CaretRight,
  Copy,
  File,
  Gear,
  Keyboard,
  Moon,
  NotePencil,
  PaperPlaneTilt,
  Plus,
  ShieldWarning,
  SidebarSimple,
  SignIn,
  Star,
  Sun,
  Trash,
  Tray,
  Warning,
} from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import type { AccountSummary, Folder } from "~/lib/mail";
import { FOLDER_LABELS, FOLDERS, formatCount } from "~/lib/mail";
import { useMail } from "./mail-context";
import { ContextMenu, copyText } from "./menu";
import { ResizeHandle } from "./resize-handle";
import { IconButton, Logo, ProviderIcon, cx } from "./ui";

export const FOLDER_ICONS: Record<Folder, typeof Tray> = {
  inbox: Tray,
  starred: Star,
  sent: PaperPlaneTilt,
  drafts: File,
  archive: Archive,
  spam: ShieldWarning,
  trash: Trash,
};

export function reconnectUrl(account: AccountSummary) {
  if (account.provider === "google" || account.provider === "microsoft") {
    return `/auth/${account.provider}?hint=${encodeURIComponent(account.email)}`;
  }
  return "/welcome";
}

export function Sidebar({
  scope,
  folder,
  onShowShortcuts,
  onToggleTheme,
  dark,
  resizable,
}: {
  scope?: string;
  folder?: Folder;
  onShowShortcuts(): void;
  onToggleTheme(): void;
  dark: boolean;
  /** Shows a handle at the right edge that changes the width of the panel. */
  resizable?: boolean;
}) {
  const { accounts, unreadCounts, openCompose } = useMail();
  const navigate = useNavigate();
  const totalUnread = Object.values(unreadCounts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const names = accountNames(accounts);

  return (
    // The panel floats in the window, as the sidebars of macOS 26 do.
    <div
      className={cx(
        "relative h-full shrink-0 p-2",
        resizable ? "w-[calc(var(--sidebar-width)+1rem)]" : "w-64",
      )}
    >
    <nav className="flex h-full flex-col rounded-[18px] border border-(--sidebar-border) bg-(--sidebar)">
      {/* The sidebar button sits at the left of the logo. It is not in the
          panel, so it stays in place when the panel goes. */}
      <div className={cx("flex items-center justify-between px-4 pb-3", resizable ? "pt-[11px] pl-11" : "pt-4")}>
        <Logo />
      </div>

      <div className="px-2.5 pb-1">
        <button
          type="button"
          onClick={() => openCompose()}
          className="flex h-8 w-full items-center gap-2 rounded-[9px] bg-accent-600 px-2.5 text-sm font-medium text-white shadow-sm shadow-accent-600/30 press hover:bg-accent-700"
        >
          <NotePencil className="size-4" />
          Compose
          <kbd className="ml-auto border-white/20 bg-white/10 text-white/80">C</kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2">
        <SectionTitle>{accounts.length > 1 ? "All accounts" : "Mailbox"}</SectionTitle>
        <ul className="space-y-px">
          {FOLDERS.map((name) => (
            <FolderLink
              key={name}
              to={`/mail/all/${name}`}
              folder={name}
              active={scope === "all" && folder === name}
              count={name === "inbox" ? totalUnread : undefined}
            />
          ))}
        </ul>

        {accounts.length > 1 && (
          <>
            <SectionTitle>Accounts</SectionTitle>
            <ul className="space-y-px">
              {accounts.map((account) => {
                const open = scope === account.id;
                return (
                  <li key={account.id}>
                    <ContextMenu
                      items={() => [
                        { label: "Open Inbox", icon: Tray, onSelect: () => navigate(`/mail/${account.id}/inbox`) },
                        {
                          label: "Open in new tab",
                          icon: ArrowSquareOut,
                          onSelect: () => window.open(`/mail/${account.id}/inbox`, "_blank", "noopener"),
                        },
                        {
                          label: "New message from this account",
                          icon: NotePencil,
                          onSelect: () => openCompose({ accountId: account.id }),
                        },
                        "separator",
                        account.status === "reauth_required" && {
                          label: "Sign in again",
                          icon: SignIn,
                          onSelect: () => {
                            const url = reconnectUrl(account);
                            if (account.provider === "imap") navigate(url);
                            else window.location.href = url;
                          },
                        },
                        { label: "Copy address", icon: Copy, onSelect: () => copyText(account.email, "the address") },
                        { label: "Account settings", icon: Gear, onSelect: () => navigate("/settings") },
                      ]}
                    >
                      <NavLink
                        to={`/mail/${account.id}/inbox`}
                        className={cx(
                          "tappable press group flex h-7 items-center gap-2 rounded-[7px] px-2 text-[13px]",
                          open && folder === "inbox"
                            ? "bg-(--sidebar-selection) text-zinc-900 dark:text-white"
                            : "text-zinc-700 hover:bg-(--sidebar-hover) dark:text-zinc-200",
                        )}
                      >
                        <CaretRight
                          className={cx("size-3 shrink-0 text-zinc-400 transition-[rotate] duration-200 ease-out", open && "rotate-90")}
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: account.color }}
                        />
                        <span className="min-w-0 flex-1 truncate" title={account.email}>{names.get(account.id)}</span>
                        {account.status === "reauth_required" ? (
                          <Warning className="size-3.5 text-amber-500" aria-label="Sign in again" />
                        ) : (
                          <Count value={unreadCounts[account.id]} />
                        )}
                      </NavLink>
                    </ContextMenu>
                    {open && (
                      <ul className="mt-px mb-1 ml-5 space-y-px border-l border-(--sidebar-border) pl-2">
                        {FOLDERS.filter((f) => f !== "inbox").map((name) => (
                          <FolderLink
                            key={name}
                            to={`/mail/${account.id}/${name}`}
                            folder={name}
                            active={folder === name}
                            compact
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {accounts.length === 1 && accounts[0].status === "reauth_required" && (
          <Link
            to={reconnectUrl(accounts[0])}
            className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            <Warning className="size-3.5" /> Sign in again to {accounts[0].email}
          </Link>
        )}
      </div>

      <div className="space-y-px px-2.5 pb-2.5">
        <Link
          to="/welcome"
          className="press flex h-7 items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-zinc-700 hover:bg-(--sidebar-hover) dark:text-zinc-200"
        >
          <Plus className="size-4 text-zinc-500 dark:text-zinc-400" /> Add account
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            className="press flex h-7 flex-1 items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-zinc-700 hover:bg-(--sidebar-hover) dark:text-zinc-200"
          >
            <Gear className="size-4 text-zinc-500 dark:text-zinc-400" /> Settings
          </Link>
          <IconButton label="Keyboard shortcuts" shortcut="?" onClick={onShowShortcuts}>
            <Keyboard className="size-4" />
          </IconButton>
          <IconButton label={dark ? "Use light theme" : "Use dark theme"} onClick={onToggleTheme}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
        </div>
        {accounts.length === 1 && (
          <div className="flex items-center gap-2 px-2 pt-1 text-xs text-zinc-500">
            <ProviderIcon provider={accounts[0].provider} className="size-3.5" />
            <span className="truncate">{accounts[0].email}</span>
          </div>
        )}
      </div>
    </nav>
    {resizable && <SidebarResizeHandle />}
    </div>
  );
}

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";
const COLLAPSED_CLASS = "sidebar-collapsed";
const COLLAPSED_EVENT = "sidebar:collapsed";
/** A drag that makes the panel this much narrower than the minimum closes it. */
const COLLAPSE_DISTANCE = 64;
export const SIDEBAR_SHORTCUT = "⌘ \\";

/** The collapsed state is a class on the root element, so CSS can lay out the
    page before React hydrates. The script in root.tsx sets it from storage. */
function isCollapsed() {
  return document.documentElement.classList.contains(COLLAPSED_CLASS);
}

export function setSidebarCollapsed(collapsed: boolean) {
  const content = document.querySelector<HTMLElement>("[data-sidebar-content]");
  // The position of the content now, with the slide that is in progress.
  const from = content?.getBoundingClientRect().left;
  content?.getAnimations().forEach((animation) => animation.cancel());
  document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsed);
  if (!collapsed) endPeek();
  if (content && from !== undefined) slideContent(content, from);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

/** An animation of the space for the sidebar lays out the full page on each
    frame, and each email frame lays out its content again. Thus the space
    changes at once, and the content slides from its old position with a
    transform. The browser can run a transform off the main thread. */
function slideContent(content: HTMLElement, from: number) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const distance = from - content.getBoundingClientRect().left;
  if (!distance) return;
  const style = getComputedStyle(document.documentElement);
  // The build can write "300ms" as ".3s".
  const time = style.getPropertyValue("--sidebar-duration").trim();
  content.animate([{ transform: `translateX(${distance}px)` }, { transform: "none" }], {
    duration: (parseFloat(time) || 0.3) * (time.endsWith("ms") ? 1 : 1000),
    easing: style.getPropertyValue("--ease-spring").trim() || "ease-out",
  });
}

let peekTimer: ReturnType<typeof setTimeout> | undefined;

/** Brings a collapsed panel out over the content. Only a pointer that comes
    in starts it, so a click on "Hide sidebar" does not bring the panel back
    while the pointer is still on the button. */
export function startPeek() {
  clearTimeout(peekTimer);
  if (isCollapsed()) document.documentElement.classList.add("sidebar-peek");
}

/** The panel waits a moment before it goes, so a pointer that leaves it by a
    small distance does not close it. */
export function stopPeek() {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(endPeek, 150);
}

function endPeek() {
  clearTimeout(peekTimer);
  document.documentElement.classList.remove("sidebar-peek");
}

export function toggleSidebar() {
  setSidebarCollapsed(!isCollapsed());
}

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSED_EVENT, onChange);
  return () => window.removeEventListener(COLLAPSED_EVENT, onChange);
}

export function useSidebarCollapsed() {
  return useSyncExternalStore(subscribeCollapsed, isCollapsed, () => false);
}

/** The sidebar button stays at the top left, as in Colima GUI. A pointer on
    it brings a collapsed panel out, and a click docks the panel again. */
export function SidebarButton() {
  const collapsed = useSidebarCollapsed();
  return (
    <div className="fixed top-5 left-[18px] z-50">
      <IconButton
        label={collapsed ? "Show sidebar" : "Hide sidebar"}
        shortcut={SIDEBAR_SHORTCUT}
        className="size-7"
        onClick={toggleSidebar}
      >
        {collapsed ? <SidebarSimple className="size-4" /> : <SidebarSimple className="size-4" />}
      </IconButton>
    </div>
  );
}
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 180;
const MAX_WIDTH = 360;

/** The element that holds the sidebar. Only it and its children read the width. */
function sidebarFrame() {
  return document.querySelector<HTMLElement>("[data-sidebar-frame]") ?? document.documentElement;
}

function currentWidth() {
  return parseFloat(getComputedStyle(sidebarFrame()).getPropertyValue("--sidebar-width")) || DEFAULT_WIDTH;
}

/** CSS variables inherit. A change on the root element recalculates the style
    of every element on the page, on each pointer move. Thus a drag changes
    the variable on the sidebar frame only. The end of the drag also writes it
    to the root element, which keeps it if the frame mounts again. */
function setWidth(width: number, save: boolean) {
  sidebarFrame().style.setProperty("--sidebar-width", `${width}px`);
  if (!save) return;
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
}

/** The space between the panel and the list is the handle, as in Colima GUI.
    As in Linear, a drag far past the minimum closes the panel. */
function SidebarResizeHandle() {
  return (
    <ResizeHandle
      edge="right"
      label="Resize sidebar"
      min={MIN_WIDTH}
      max={MAX_WIDTH}
      className="in-[.sidebar-collapsed]:hidden"
      size={currentWidth}
      onResize={setWidth}
      onReset={() => setWidth(DEFAULT_WIDTH, true)}
      onOvershoot={{ distance: COLLAPSE_DISTANCE, run: () => setSidebarCollapsed(true) }}
    />
  );
}

/** The sidebar shows the part of the address before the "@" when no other
    account has the same part. The full address is in the tooltip. */
function accountNames(accounts: AccountSummary[]) {
  const local = (email: string) => email.split("@")[0];
  const seen = new Map<string, number>();
  for (const account of accounts) seen.set(local(account.email), (seen.get(local(account.email)) ?? 0) + 1);
  return new Map(
    accounts.map((account) => [
      account.id,
      seen.get(local(account.email)) === 1 ? local(account.email) : account.email,
    ]),
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-2 pt-4 pb-1 text-[11px] font-semibold text-zinc-500 first:pt-1 dark:text-zinc-400">
      {children}
    </h2>
  );
}

function Count({ value }: { value: number | null | undefined }) {
  if (!value) return null;
  return (
    <span className="text-[11px] text-zinc-400 tabular-nums dark:text-zinc-500">
      {formatCount(value)}
    </span>
  );
}

function FolderLink({
  to,
  folder,
  active,
  count,
  compact,
}: {
  to: string;
  folder: Folder;
  active: boolean;
  count?: number;
  compact?: boolean;
}) {
  const Icon = FOLDER_ICONS[folder];
  const navigate = useNavigate();
  return (
    <li>
      <ContextMenu
        items={() => [
          { label: `Open ${FOLDER_LABELS[folder]}`, icon: Icon, onSelect: () => navigate(to) },
          { label: "Open in new tab", icon: ArrowSquareOut, onSelect: () => window.open(to, "_blank", "noopener") },
          { label: "Copy link", icon: Copy, onSelect: () => copyText(new URL(to, window.location.origin).href, "the link") },
        ]}
      >
        <Link
          to={to}
          prefetch="intent"
          className={cx(
            // As in the system sidebars, the selected row has a fill and no
            // bold text. A hovered row has a lighter fill of the same color.
            "tappable press flex items-center gap-2.5 rounded-[7px] px-2 text-[13px]",
            compact ? "h-6" : "h-7",
            active
              ? "bg-(--sidebar-selection) text-zinc-900 dark:text-white"
              : "text-zinc-700 hover:bg-(--sidebar-hover) dark:text-zinc-200",
          )}
        >
          <Icon
            weight={active ? "fill" : "regular"}
            className={cx(
              "size-4 shrink-0",
              active ? "text-accent-600 dark:text-accent-400" : "text-zinc-500 dark:text-zinc-400",
            )}
          />
          <span className="flex-1">{FOLDER_LABELS[folder]}</span>
          <Count value={count} />
        </Link>
      </ContextMenu>
    </li>
  );
}
