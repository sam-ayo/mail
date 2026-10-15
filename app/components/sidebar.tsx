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
  SignOut,
  Star,
  Sun,
  Trash,
  Tray,
  Warning,
} from "./icons";
import { type ComponentProps, createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, NavLink, matchPath, useFetcher, useNavigate, useNavigation } from "react-router";
import type { AccountSummary, Folder } from "~/lib/mail";
import { FOLDER_LABELS, FOLDERS, formatCount, isFolder, PREFETCH_PARAM, shownProvider } from "~/lib/mail";
import { removeAccountPrompt, useConfirm } from "./confirm-dialog";
import { useMail } from "./mail-context";
import { ContextMenu, copyText } from "./menu";
import { ResizeHandle } from "./resize-handle";
import { AccountIcon, Hint, IconButton, Logo, PROVIDER_NAMES, cx } from "./ui";

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

/** The list loads before the route changes. The sidebar shows the folder
    that loads, so a click changes the sidebar at once. */
function usePendingFolder(scope: string | undefined, folder: Folder | undefined) {
  const { location } = useNavigation();
  const match = location && matchPath("/mail/:scope/:folder/*", location.pathname);
  if (!match || !isFolder(match.params.folder)) return { scope, folder };
  return { scope: match.params.scope, folder: match.params.folder };
}

/** Loads a list on hover, so the list shows at once after a click. The list
    route caches what the fetcher loads. */
function useHoverPrefetch(to: string, active: boolean) {
  const fetcher = useFetcher();
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function prefetch(start: boolean) {
    clearTimeout(hoverTimer.current);
    if (start && !active) hoverTimer.current = setTimeout(() => fetcher.load(`${to}?${PREFETCH_PARAM}`), 80);
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  return {
    onMouseEnter: () => prefetch(true),
    onMouseLeave: () => prefetch(false),
    onFocus: () => prefetch(true),
  };
}

/** A long press on a row opens a menu. In the drawer the menus are off, because
    a menu catches the touch, and then a swipe on a row does not close the drawer. */
const RowMenus = createContext(true);

export function Sidebar({
  scope: shownScope,
  folder: shownFolder,
  onShowShortcuts,
  onToggleTheme,
  dark,
  resizable,
  drawer,
}: {
  scope?: string;
  folder?: Folder;
  onShowShortcuts(): void;
  onToggleTheme(): void;
  dark: boolean;
  /** Shows a handle at the right edge that changes the width of the panel. */
  resizable?: boolean;
  /** The panel is in the drawer on a small screen. */
  drawer?: boolean;
}) {
  const { accounts, unreadCounts, openCompose } = useMail();
  const { scope, folder } = usePendingFolder(shownScope, shownFolder);
  const navigate = useNavigate();
  const remover = useFetcher();
  const confirm = useConfirm();
  // A click on the row of the open account closes its folders. A move to
  // another account opens them again.
  const [closedAccount, setClosedAccount] = useState<string | null>(null);
  useEffect(() => setClosedAccount(null), [scope]);

  // The settings route removes the account. The mail stays on the server.
  async function removeAccount(account: AccountSummary) {
    if (!(await confirm(removeAccountPrompt(account.email)))) return;
    remover.submit({ intent: "remove", accountId: account.id }, { method: "post", action: "/settings" });
    if (scope === account.id) navigate("/mail/all/inbox");
  }
  const totalUnread = Object.values(unreadCounts).reduce<number>((sum, n) => sum + (n ?? 0), 0);

  return (
    // The panel floats in the window, as the sidebars of macOS 26 do.
    <RowMenus.Provider value={!drawer}>
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
        {/* Compose has the shape of a folder row, with the accent color.
            The shortcut is plain text, as the counts are. */}
        <button
          type="button"
          onClick={() => openCompose()}
          aria-keyshortcuts="c"
          className="tappable press flex h-7 w-full items-center gap-2.5 rounded-[7px] px-2 text-[13px] font-medium pointer-coarse:h-11 pointer-coarse:text-base text-accent-600 hover:bg-(--sidebar-hover) dark:text-accent-400"
        >
          <NotePencil className="size-4 shrink-0" />
          <span className="flex-1 text-left">New message</span>
          <span aria-hidden className="text-[11px] font-normal text-zinc-400 pointer-coarse:hidden dark:text-zinc-500">
            C
          </span>
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
                const current = scope === account.id;
                const open = current && closedAccount !== account.id;
                return (
                  <li key={account.id}>
                    <ContextMenu
                      disabled={drawer}
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
                        "separator",
                        {
                          label: "Remove account",
                          icon: SignOut,
                          danger: true,
                          onSelect: () => removeAccount(account),
                        },
                      ]}
                    >
                      <AccountLink
                        to={`/mail/${account.id}/inbox`}
                        active={current && folder === "inbox"}
                        aria-expanded={open}
                        onClick={(event) => {
                          if (!current || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          // The inbox is on the screen, so the click only opens or closes the folders.
                          if (folder === "inbox") {
                            event.preventDefault();
                            setClosedAccount(open ? account.id : null);
                          } else {
                            setClosedAccount(null);
                          }
                        }}
                        className={cx(
                          "tappable group flex h-7 transition-colors duration-160 ease-out items-center gap-2 rounded-[7px] px-2 text-[13px] pointer-coarse:h-11 pointer-coarse:text-base",
                          current && folder === "inbox"
                            ? "bg-(--sidebar-selection) text-zinc-900 dark:text-white"
                            : "text-zinc-700 hover:bg-(--sidebar-hover) dark:text-zinc-200",
                        )}
                      >
                        <CaretRight
                          className={cx("size-3 shrink-0 text-zinc-400 transition-[rotate] duration-200 ease-out", open && "rotate-90")}
                        />
                        {/* The color dot on the account icon matches the dots in the message list.
                            The dot shows only when the account has unread messages.
                            The wrapper is flex, so the icon does not sit on the text baseline
                            and the dot stays on the corner of the icon. The ring has the color
                            of the row, so it cuts the icon in each row state. */}
                        <span className="relative flex shrink-0" title={PROVIDER_NAMES[shownProvider(account)]}>
                          <AccountIcon account={account} className="size-3.5 text-zinc-500" />
                          {!!unreadCounts[account.id] && (
                            <span
                              className={cx(
                                "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-[1.5px]",
                                current && folder === "inbox"
                                  ? "ring-(--sidebar-selection)"
                                  : "ring-(--sidebar) group-hover:ring-[color-mix(in_oklab,var(--sidebar-selection)_50%,var(--sidebar))]",
                              )}
                              style={{ background: account.color }}
                            />
                          )}
                        </span>
                        <AccountAddress email={account.email} />
                        {account.status === "reauth_required" ? (
                          <Warning className="size-3.5 text-amber-500" aria-label="Sign in again" />
                        ) : (
                          <Count value={unreadCounts[account.id]} />
                        )}
                      </AccountLink>
                    </ContextMenu>
                    {/* The folders stay in the page so that the height can animate.
                        A grid row from 0fr to 1fr animates to the height of the content. */}
                    <div
                      inert={!open}
                      className={cx(
                        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-opacity",
                        open ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <ul className="mt-px mb-1 ml-5 space-y-px border-l border-(--sidebar-border) pl-2">
                          {FOLDERS.filter((f) => f !== "inbox").map((name) => (
                            <FolderLink
                              key={name}
                              to={`/mail/${account.id}/${name}`}
                              folder={name}
                              active={open && folder === name}
                              compact
                            />
                          ))}
                        </ul>
                      </div>
                    </div>
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
          className="press flex h-7 items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-zinc-700 pointer-coarse:h-11 pointer-coarse:text-base hover:bg-(--sidebar-hover) dark:text-zinc-200"
        >
          <Plus className="size-4 text-zinc-500 dark:text-zinc-400" /> Add account
        </Link>
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            className="press flex h-7 flex-1 items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-zinc-700 pointer-coarse:h-11 pointer-coarse:text-base hover:bg-(--sidebar-hover) dark:text-zinc-200"
          >
            <Gear className="size-4 text-zinc-500 dark:text-zinc-400" /> Settings
          </Link>
          <FooterButton label="Keyboard shortcuts" shortcut="?" className="pointer-coarse:hidden" onClick={onShowShortcuts}>
            <Keyboard className="size-4" />
          </FooterButton>
          <FooterButton label={dark ? "Use light theme" : "Use dark theme"} onClick={onToggleTheme}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </FooterButton>
        </div>
        {accounts.length === 1 && (
          <div className="flex items-center gap-2 px-2 pt-1 text-xs text-zinc-500">
            <AccountIcon account={accounts[0]} className="size-3.5" />
            <span className="truncate">{accounts[0].email}</span>
          </div>
        )}
      </div>
    </nav>
    {resizable && <SidebarResizeHandle />}
    </div>
    </RowMenus.Provider>
  );
}

/** An icon button with the same hover as the Settings link beside it. */
function FooterButton({
  label,
  shortcut,
  className,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cx(
          "press grid size-7 shrink-0 place-items-center rounded-[7px] text-zinc-500 hover:bg-(--sidebar-hover) pointer-coarse:size-11 dark:text-zinc-400",
          className,
        )}
      >
        {children}
      </button>
    </Hint>
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
  const centered = [...(content?.querySelectorAll<HTMLElement>("[data-sidebar-centered]") ?? [])];
  const centeredFrom = centered.map((element) => element.getBoundingClientRect().left);
  [content, ...centered].forEach((element) => element?.getAnimations().forEach((animation) => animation.cancel()));
  document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsed);
  if (!collapsed) endPeek();
  if (content && from !== undefined) slideContent(content, from, centered, centeredFrom);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

/** An animation of the space for the sidebar lays out the full page on each
    frame, and each email frame lays out its content again. Thus the space
    changes at once, and the content slides from its old position with a
    transform. The browser can run a transform off the main thread.

    An element that has "data-sidebar-centered" is centered in a pane that
    changes width. The pane gets wider at once, so the element jumps by half
    the sidebar width before the slide starts. A second transform on the
    element moves it from its old position to its new position, with no jump. */
function slideContent(content: HTMLElement, from: number, centered: HTMLElement[], centeredFrom: number[]) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const distance = from - content.getBoundingClientRect().left;
  if (!distance) return;
  const style = getComputedStyle(document.documentElement);
  // The build can write "300ms" as ".3s".
  const time = style.getPropertyValue("--sidebar-duration").trim();
  const options = {
    duration: (parseFloat(time) || 0.3) * (time.endsWith("ms") ? 1 : 1000),
    easing: style.getPropertyValue("--ease-spring").trim() || "ease-out",
  };
  // Measure the new positions before the slide starts. The slide moves the
  // elements, and a later measurement counts the distance two times.
  const centeredTo = centered.map((element) => element.getBoundingClientRect().left);
  content.animate([{ transform: `translateX(${distance}px)` }, { transform: "none" }], options);
  centered.forEach((element, i) => {
    // The slide of the content also moves the element, so remove that part.
    const offset = centeredFrom[i] - centeredTo[i] - distance;
    if (offset) element.animate([{ transform: `translateX(${offset}px)` }, { transform: "none" }], options);
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

/** The domain is lighter than the local part, so two accounts with the same
    name ("sam@gmail.com", "sam@notableai.ca") stay different. */
function AccountAddress({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  return (
    <span className="min-w-0 flex-1 truncate" title={email}>
      {at < 0 ? email : (
        <>
          {email.slice(0, at)}
          <span className="text-zinc-400 dark:text-zinc-500">{email.slice(at)}</span>
        </>
      )}
    </span>
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

function AccountLink({ active, ...props }: { active: boolean } & ComponentProps<typeof NavLink>) {
  return <NavLink {...props} {...useHoverPrefetch(String(props.to), active)} />;
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
  const prefetch = useHoverPrefetch(to, active);
  const rowMenus = useContext(RowMenus);
  return (
    <li>
      <ContextMenu
        disabled={!rowMenus}
        items={() => [
          { label: `Open ${FOLDER_LABELS[folder]}`, icon: Icon, onSelect: () => navigate(to) },
          { label: "Open in new tab", icon: ArrowSquareOut, onSelect: () => window.open(to, "_blank", "noopener") },
          { label: "Copy link", icon: Copy, onSelect: () => copyText(new URL(to, window.location.origin).href, "the link") },
        ]}
      >
        <Link
          to={to}
          {...prefetch}
          className={cx(
            // As in the system sidebars, the selected row has a fill and no
            // bold text. A hovered row has a lighter fill of the same color.
            "tappable flex items-center gap-2.5 transition-colors duration-160 ease-out rounded-[7px] px-2 text-[13px]",
            compact ? "h-6 pointer-coarse:h-10" : "h-7 pointer-coarse:h-11 pointer-coarse:text-base",
            active
              ? "bg-(--sidebar-selection) text-zinc-900 dark:text-white"
              : "text-zinc-700 hover:bg-(--sidebar-hover) dark:text-zinc-200",
          )}
        >
          <Icon
            weight={active ? "bold" : "regular"}
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
