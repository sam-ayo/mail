import {
  Archive,
  ArrowBendDoubleUpLeft,
  ArrowBendUpLeft,
  ArrowBendUpRight,
  ArrowClockwise,
  ArrowSquareOut,
  CheckSquare,
  CircleNotch,
  Copy,
  EnvelopeSimple,
  EnvelopeSimpleOpen,
  LinkSimple,
  List,
  MagnifyingGlass,
  Paperclip,
  ShieldWarning,
  Star,
  Trash,
  Tray,
  Warning,
  X,
} from "~/components/icons";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  data,
  Form,
  Link,
  Outlet,
  useFetcher,
  useLocation,
  useNavigate,
  useNavigation,
  useParams,
  useRevalidator,
} from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { useHotkeys } from "~/components/hotkeys";
import { LocalDate } from "~/components/local-date";
import type { ThreadRef } from "~/components/mail-context";
import { applyPatch, replyRequest, useMail } from "~/components/mail-context";
import type { MenuEntry } from "~/components/menu";
import { ContextMenu, copyText, openContextMenuAt } from "~/components/menu";
import { setListCollapsed } from "~/components/list-panel";
import { ResizeHandle } from "~/components/resize-handle";
import { reconnectUrl } from "~/components/sidebar";
import { AccountIcon, Avatar, Hint, IconButton, cx } from "~/components/ui";
import type { AccountSummary, Folder, ThreadAction, ThreadSummary } from "~/lib/mail";
import {
  displayName,
  FOLDER_LABELS,
  formatCount,
  formatListDate,
  isFolder,
  mergeDuplicates,
  PREFETCH_PARAM,
  threadKey,
  threadRefs,
} from "~/lib/mail";
import { userContext } from "~/server/context";
import { listThreads } from "~/server/mail.server";
import { ProviderError } from "~/server/providers/types";
import type { Route } from "./+types/mail.list";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  if (!isFolder(params.folder)) throw data("Folder not found", { status: 404 });
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  try {
    const result = await listThreads(user.id, {
      scope: params.scope,
      folder: params.folder,
      query,
      cursor: url.searchParams.get("cursor"),
    });
    return { ...result, query };
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      throw data("Account not found", { status: 404 });
    }
    throw error;
  }
}

type ListData = Awaited<ReturnType<typeof loader>>;
interface ListCacheEntry {
  data?: ListData;
  /** Time the data loaded. */
  at: number;
  pending?: Promise<ListData>;
}

// First pages of lists that loaded before. A folder that you open again, or
// that loaded early on hover, shows at once. It then reloads in the background.
const listCache = new Map<string, ListCacheEntry>();
const LIST_CACHE_LIMIT = 30;
/** Cached data newer than this shows with no reload in the background. */
const LIST_FRESH_MS = 10_000;
/** A hover prefetch skips cached data newer than this. Each Gmail list load uses quota. */
const PREFETCH_FRESH_MS = 60_000;
/** The list on the screen. A reload of it always asks the server. */
let shownListKey: string | null = null;

function listKey(scope: string, folder: string, query: string) {
  return `${scope}/${folder}?${query}`;
}

function rememberList(key: string, data: ListData, at: number) {
  listCache.delete(key);
  listCache.set(key, { data, at });
  if (listCache.size > LIST_CACHE_LIMIT) listCache.delete(listCache.keys().next().value!);
}

function fetchList(key: string, serverLoader: () => Promise<ListData>) {
  const previous = listCache.get(key);
  const pending = serverLoader().then(
    (data) => {
      rememberList(key, data, Date.now());
      return data;
    },
    (error) => {
      if (listCache.get(key)?.pending === pending) {
        if (previous?.data) listCache.set(key, { data: previous.data, at: previous.at });
        else listCache.delete(key);
      }
      throw error;
    },
  );
  listCache.set(key, { data: previous?.data, at: previous?.at ?? 0, pending });
  return pending;
}

export async function clientLoader({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  // Later pages from infinite scroll do not use the cache.
  if (url.searchParams.has("cursor")) return { ...(await serverLoader()), loadedAt: Date.now() };
  const key = listKey(params.scope, params.folder, url.searchParams.get("q")?.trim() ?? "");
  const prefetch = url.searchParams.has(PREFETCH_PARAM);
  const entry = listCache.get(key);

  if (entry?.data && key !== shownListKey) {
    const refresh =
      Date.now() - entry.at > (prefetch ? PREFETCH_FRESH_MS : LIST_FRESH_MS)
        ? (entry.pending ?? fetchList(key, serverLoader)).then(
            (data) => ({ ...data, loadedAt: Date.now() }),
            () => null,
          )
        : undefined;
    return { ...entry.data, loadedAt: entry.at, refresh };
  }

  if (entry?.pending && key !== shownListKey) {
    // A hover prefetch can stop before it completes. Then load again.
    try {
      return { ...(await entry.pending), loadedAt: Date.now() };
    } catch (error) {
      if (request.signal.aborted) throw error;
    }
  }

  if (key === shownListKey) {
    // A reload of the open list follows a change or asks for new mail. Other
    // lists may be out of date too, so they reload when you open them.
    for (const other of listCache.values()) other.at = 0;
  }
  const load = fetchList(key, serverLoader).then((data) => ({ ...data, loadedAt: Date.now() }));
  // An error from a fetcher replaces the full page, so a failed prefetch
  // stays silent. If you open the folder, the error shows then.
  return prefetch ? load.catch(() => null as never) : load;
}

export function shouldRevalidate({
  currentParams,
  nextParams,
  currentUrl,
  nextUrl,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Opening another conversation in the same list does not change the list.
  const sameList =
    currentParams.scope === nextParams.scope &&
    currentParams.folder === nextParams.folder &&
    currentUrl.searchParams.get("q") === nextUrl.searchParams.get("q");
  if (!formAction && sameList && currentUrl.pathname !== nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}

export const meta: Route.MetaFunction = ({ params }) => [
  { title: `${isFolder(params.folder) ? FOLDER_LABELS[params.folder] : "Mail"} · mail` },
];

export interface ListOutletContext {
  folder: Folder;
  threads: ThreadSummary[];
  /** Runs an action on the open conversation, then opens the next one if needed. */
  actOnOpenThread(action: ThreadAction): void;
  openRelative(offset: 1 | -1): void;
  closeThread(): void;
}

function ThreadList({ loaderData: routeData, params }: Route.ComponentProps) {
  const { scope } = params;
  const folder = params.folder as Folder;

  // A cached list shows first. Newer data from the server replaces it when it arrives.
  const [fresh, setFresh] = useState<{ from: typeof routeData; data: ListData; loadedAt: number }>();
  useEffect(() => {
    if (!("refresh" in routeData) || !routeData.refresh) return;
    let live = true;
    routeData.refresh.then((result) => {
      if (live && result) setFresh({ from: routeData, data: result, loadedAt: result.loadedAt });
    });
    return () => {
      live = false;
    };
  }, [routeData]);
  const current = fresh?.from === routeData ? fresh : null;
  const loaderData: ListData = current?.data ?? routeData;
  // The first page from the server render has no load time.
  const renderedAt = useMemo(() => Date.now(), [routeData]);
  const loadedAt = current?.loadedAt ?? ("loadedAt" in routeData ? routeData.loadedAt : renderedAt);

  const shownKey = listKey(scope, folder, loaderData.query);
  useEffect(() => {
    // The server render does not go through the client loader. Keep its list too.
    if (!listCache.has(shownKey)) rememberList(shownKey, loaderData, loadedAt);
    shownListKey = shownKey;
    return () => {
      if (shownListKey === shownKey) shownListKey = null;
    };
  }, [shownKey, loaderData, loadedAt]);

  const { accounts, account, patches, runAction } = useMail();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const childParams = useParams();
  const moreFetcher = useFetcher<typeof loader>();
  const searchRef = useRef<HTMLInputElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const listRef = useRef<HTMLElement>(null);

  // Extra pages from infinite scroll. A new first page resets them.
  const [extra, setExtra] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState(loaderData.nextCursor);
  useEffect(() => {
    setExtra([]);
    setCursor(loaderData.nextCursor);
  }, [loaderData]);
  useEffect(() => {
    if (!moreFetcher.data) return;
    setExtra((current) => [...current, ...moreFetcher.data!.threads]);
    setCursor(moreFetcher.data.nextCursor);
  }, [moreFetcher.data]);

  const threads = useMemo(() => {
    const seen = new Set<string>();
    const unique = [...loaderData.threads, ...extra].filter((thread) => {
      const key = threadKey(thread.accountId, thread.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Merge across all loaded pages, so a copy on a later page joins its row.
    return (scope === "all" ? mergeDuplicates(unique) : unique)
      .map((thread) => applyPatch(thread, patches[threadKey(thread.accountId, thread.id)], loadedAt))
      .filter((thread) => !thread.removed);
  }, [loaderData.threads, extra, patches, loadedAt, scope]);

  const openKey =
    childParams.accountId && childParams.threadId
      ? threadKey(childParams.accountId, childParams.threadId)
      : null;
  const openIndex = openKey
    ? threads.findIndex((t) => threadKey(t.accountId, t.id) === openKey)
    : -1;

  const [focusIndex, setFocusIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [scope, folder, loaderData.query]);
  useEffect(() => {
    if (openIndex >= 0) setFocusIndex(openIndex);
  }, [openIndex]);
  const focused = threads[Math.min(focusIndex, threads.length - 1)];

  // Keyboard moves jump with no smooth scroll. Animation would make j and k feel slow.
  useEffect(() => {
    virtuosoRef.current?.scrollIntoView({ index: focusIndex, behavior: "auto" });
  }, [focusIndex]);

  const search = loaderData.query ? `?q=${encodeURIComponent(loaderData.query)}` : "";
  const base = `/mail/${scope}/${folder}`;
  const hrefFor = (thread: ThreadSummary) => `${base}/${thread.accountId}/${thread.id}${search}`;
  const prefetchHref = (thread: ThreadSummary) =>
    `${hrefFor(thread)}${search ? "&" : "?"}${PREFETCH_PARAM}`;
  const openThread = (thread: ThreadSummary | undefined) => thread && navigate(hrefFor(thread));
  const closeThread = () => navigate(`${base}${search}`);

  // The thread route caches what these fetchers load, so the open shows at once.
  const hoverFetcher = useFetcher();
  const nextFetcher = useFetcher();
  const previousFetcher = useFetcher();
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function prefetch(thread: ThreadSummary | null) {
    clearTimeout(hoverTimer.current);
    if (thread) hoverTimer.current = setTimeout(() => hoverFetcher.load(prefetchHref(thread)), 80);
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  // Load the conversations next to the open one for j and k. With no open
  // conversation, load the focused row for Enter.
  const nextThread = openIndex >= 0 ? threads[openIndex + 1] : focused;
  const previousThread = openIndex > 0 ? threads[openIndex - 1] : undefined;
  const nextHref = nextThread && prefetchHref(nextThread);
  const previousHref = previousThread && prefetchHref(previousThread);
  useEffect(() => {
    if (nextHref) nextFetcher.load(nextHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextHref]);
  useEffect(() => {
    if (previousHref) previousFetcher.load(previousHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousHref]);

  function loadMore() {
    if (!cursor || moreFetcher.state !== "idle") return;
    const params = new URLSearchParams({ cursor });
    if (loaderData.query) params.set("q", loaderData.query);
    moreFetcher.load(`${base}?${params}`);
  }

  function targetThreads(): ThreadSummary[] {
    if (selected.size > 0) return threads.filter((t) => selected.has(threadKey(t.accountId, t.id)));
    const thread = openIndex >= 0 ? threads[openIndex] : focused;
    return thread ? [thread] : [];
  }

  // A merged row sends the action to its copies too, but counts as one conversation.
  function act(action: ThreadAction, rows = targetThreads(), direction: 1 | -1 = 1) {
    if (rows.length === 0) return;
    const refs: ThreadRef[] = rows.flatMap(threadRefs);
    const keys = new Set(refs.map((r) => threadKey(r.accountId, r.threadId)));
    // If the open conversation leaves the list, open the next one in the direction.
    if (openKey && keys.has(openKey) && isRemoval(action, folder)) {
      const stays = (t: ThreadSummary) => !keys.has(threadKey(t.accountId, t.id));
      const after = threads.slice(openIndex + 1).find(stays);
      const before = threads.slice(0, openIndex).reverse().find(stays);
      const next = direction === 1 ? (after ?? before) : (before ?? after);
      if (next) openThread(next);
      else closeThread();
    }
    runAction(refs, action, { folder, count: rows.length });
    setSelected(new Set());
  }

  function toggleStar() {
    const rows = targetThreads();
    act(rows[0]?.starred ? "unstar" : "star", rows);
  }

  function selectWhere(test: (thread: ThreadSummary) => boolean) {
    setSelected(new Set(threads.filter(test).map((t) => threadKey(t.accountId, t.id))));
  }

  function toggleSelected(thread: ThreadSummary) {
    const key = threadKey(thread.accountId, thread.id);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function move(offset: 1 | -1) {
    if (openIndex >= 0) {
      openThread(threads[openIndex + offset]);
    } else {
      setFocusIndex((i) => Math.max(0, Math.min(threads.length - 1, i + offset)));
    }
    if (offset === 1 && focusIndex >= threads.length - 5) loadMore();
  }

  function jumpTo(index: number) {
    if (index < 0 || index >= threads.length) return;
    if (openIndex >= 0) openThread(threads[index]);
    else setFocusIndex(index);
  }

  const reply = (mode: "reply" | "replyAll" | "forward") =>
    window.dispatchEvent(new CustomEvent("mail:reply", { detail: mode }));

  /** Opens the conversation, if it is not open, and starts a reply. */
  function replyTo(thread: ThreadSummary, mode: "reply" | "replyAll" | "forward") {
    const key = threadKey(thread.accountId, thread.id);
    if (key === openKey) return reply(mode);
    replyRequest.current = { key, mode };
    openThread(thread);
  }

  const archiveAction: ThreadAction = folder === "archive" ? "inbox" : "archive";

  function openMenu() {
    if (!focused) return;
    const key = threadKey(focused.accountId, focused.id);
    openContextMenuAt(document.querySelector(`[data-thread-key="${CSS.escape(key)}"]`));
  }

  /**
   * The right-click menu of a row. If the row is part of a selection, the
   * actions apply to all selected conversations.
   */
  function menuFor(thread: ThreadSummary): MenuEntry[] {
    const key = threadKey(thread.accountId, thread.id);
    const bulk = selected.size > 1 && selected.has(key);
    const rows = bulk ? threads.filter((t) => selected.has(threadKey(t.accountId, t.id))) : [thread];
    const count = bulk ? ` · ${rows.length}` : "";
    const sender = thread.participants[0];
    const restore = folder === "archive" || folder === "trash" || folder === "spam";
    const unread = rows.some((t) => t.unread);
    const starred = rows.every((t) => t.starred);
    return [
      !bulk && { label: "Open", icon: EnvelopeSimpleOpen, shortcut: "↵", onSelect: () => openThread(thread) },
      !bulk && {
        label: "Open in new tab",
        icon: ArrowSquareOut,
        onSelect: () => window.open(hrefFor(thread), "_blank", "noopener"),
      },
      "separator",
      !bulk && { label: "Reply", icon: ArrowBendUpLeft, shortcut: "R", onSelect: () => replyTo(thread, "reply") },
      !bulk && { label: "Reply all", icon: ArrowBendDoubleUpLeft, shortcut: "A", onSelect: () => replyTo(thread, "replyAll") },
      !bulk && { label: "Forward", icon: ArrowBendUpRight, shortcut: "F", onSelect: () => replyTo(thread, "forward") },
      "separator",
      restore
        ? { label: `Move to Inbox${count}`, icon: Tray, onSelect: () => act("inbox", rows) }
        : { label: `Archive${count}`, icon: Archive, shortcut: "E", onSelect: () => act("archive", rows) },
      folder !== "spam" && {
        label: `Mark as spam${count}`,
        icon: ShieldWarning,
        shortcut: "!",
        onSelect: () => act("spam", rows),
      },
      folder !== "trash" && {
        label: `Move to Trash${count}`,
        icon: Trash,
        shortcut: "#",
        danger: true,
        onSelect: () => act("trash", rows),
      },
      "separator",
      unread
        ? { label: `Mark as read${count}`, icon: EnvelopeSimpleOpen, shortcut: "⇧ I", onSelect: () => act("read", rows) }
        : { label: `Mark as unread${count}`, icon: EnvelopeSimple, shortcut: "U", onSelect: () => act("unread", rows) },
      starred
        ? { label: `Remove star${count}`, icon: Star, shortcut: "S", onSelect: () => act("unstar", rows) }
        : { label: `Star${count}`, icon: Star, shortcut: "S", onSelect: () => act("star", rows) },
      "separator",
      {
        label: selected.has(key) ? "Deselect" : "Select",
        icon: CheckSquare,
        shortcut: "X",
        onSelect: () => toggleSelected(thread),
      },
      selected.size > 0 && { label: "Clear selection", icon: X, shortcut: "Esc", onSelect: () => setSelected(new Set()) },
      "separator",
      !bulk &&
        sender && {
          label: `Find mail from ${displayName(sender)}`,
          icon: MagnifyingGlass,
          onSelect: () => navigate(`${base}?q=${encodeURIComponent(sender.email)}`),
        },
      !bulk && sender && { label: "Copy sender address", icon: Copy, onSelect: () => copyText(sender.email, "the address") },
      !bulk && { label: "Copy subject", icon: Copy, onSelect: () => copyText(thread.subject, "the subject") },
      !bulk && {
        label: "Copy link",
        icon: LinkSimple,
        onSelect: () => copyText(new URL(hrefFor(thread), window.location.origin).href, "the link"),
      },
    ];
  }

  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    o: () => openThread(focused),
    Enter: () => openThread(focused),
    Escape: () => {
      if (selected.size) setSelected(new Set());
      else if (openKey) closeThread();
    },
    Home: () => jumpTo(0),
    End: () => jumpTo(threads.length - 1),
    e: () => act(archiveAction),
    "]": () => act(archiveAction, undefined, 1),
    "[": () => act(archiveAction, undefined, -1),
    "#": () => act("trash"),
    "!": () => act(folder === "spam" ? "inbox" : "spam"),
    s: toggleStar,
    u: () => act("unread"),
    "shift+u": () => act("unread"),
    "shift+i": () => act("read"),
    x: () => focused && toggleSelected(focused),
    "* a": () => selectWhere(() => true),
    "* n": () => setSelected(new Set()),
    "* r": () => selectWhere((t) => !t.unread),
    "* u": () => selectWhere((t) => t.unread),
    "* s": () => selectWhere((t) => t.starred),
    "* t": () => selectWhere((t) => !t.starred),
    "shift+r": () => revalidator.revalidate(),
    "shift+F10": openMenu,
    ContextMenu: openMenu,
    r: () => openKey && reply("reply"),
    a: () => openKey && reply("replyAll"),
    f: () => openKey && reply("forward"),
    "/": () => searchRef.current?.focus(),
  });

  const context: ListOutletContext = {
    folder,
    threads,
    actOnOpenThread: (action) => act(action, targetThreads().slice(0, 1)),
    openRelative: (offset) => move(offset),
    closeThread,
  };

  const scopeAccount = scope === "all" ? undefined : account(scope);
  const showAccount = scope === "all" && accounts.length > 1;
  const loading =
    navigation.state === "loading" &&
    navigation.location.pathname.split("/").slice(0, 4).join("/") !== base;
  const refreshing = revalidator.state === "loading";

  return (
    // The list slides out past the left edge of this pane, which clips it.
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      <section
        ref={listRef}
        data-list
        className={cx(
          "relative flex min-w-0 flex-col border-r border-zinc-200 dark:border-zinc-800",
          // The resize handle sets --list-width. Without it, the default width applies.
          "w-full lg:w-[var(--list-width,420px)] lg:shrink-0 xl:w-[var(--list-width,460px)]",
          openKey && "hidden lg:flex lg:in-[.list-collapsed]:hidden",
        )}
      >
        <ListResizeHandle list={listRef} collapsible={Boolean(openKey)} />
        {/* With the sidebar collapsed, the header moves away from the sidebar
            button, on the spring of the sidebar. */}
        <header className="flex flex-col gap-3 border-b border-zinc-200 px-4 pt-4 pb-3 transition-[padding] duration-(--sidebar-duration) ease-spring motion-reduce:transition-none dark:border-zinc-800 md:in-[.sidebar-collapsed]:pl-14">
          <div className="flex items-center gap-2">
            <IconButton
              label="Folders"
              className="md:hidden"
              onClick={() => window.dispatchEvent(new Event("mail:open-nav"))}
            >
              <List className="size-4" />
            </IconButton>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {loaderData.query ? "Search results" : FOLDER_LABELS[folder]}
              </h1>
              {scopeAccount && (
                <p className="truncate text-xs text-zinc-500">{scopeAccount.email}</p>
              )}
            </div>
            {selected.size > 0 ? (
              <BulkActions
                count={selected.size}
                folder={folder}
                onAction={(action) => act(action)}
                onClear={() => setSelected(new Set())}
                onSelectAll={() =>
                  setSelected(new Set(threads.map((t) => threadKey(t.accountId, t.id))))
                }
              />
            ) : (
              <IconButton
                label="Check for new mail"
                onClick={() => revalidator.revalidate()}
                disabled={refreshing}
              >
                <ArrowClockwise className={cx("size-4", refreshing && "animate-spin")} />
              </IconButton>
            )}
          </div>
          <Form method="get" action={base} className="relative">
            <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchRef}
              key={`${base}-${loaderData.query}`}
              name="q"
              type="search"
              enterKeyHint="search"
              defaultValue={loaderData.query}
              placeholder={`Search ${scopeAccount ? scopeAccount.email : "all mail"}`}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.blur();
                  if (loaderData.query) navigate(base);
                }
              }}
              className="w-full rounded-lg border border-transparent bg-zinc-100 py-1.5 pr-10 pl-9 text-sm outline-none transition-[background-color,border-color,box-shadow] placeholder:text-zinc-400 focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/20 dark:bg-zinc-900 dark:focus:bg-zinc-900"
            />
            <kbd className="absolute top-1/2 right-2.5 -translate-y-1/2">/</kbd>
          </Form>
        </header>

        {loaderData.errors.map((error) => {
          const failed = account(error.accountId);
          return (
            <div
              key={error.accountId}
              className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <Warning className="mt-0.5 size-3.5 shrink-0" />
              <p className="flex-1">
                <span className="font-medium">{error.email}:</span> {error.message}
              </p>
              {error.reauth && failed && (
                <Link to={reconnectUrl(failed)} className="font-semibold underline" reloadDocument={failed.provider !== "imap"}>
                  Sign in again
                </Link>
              )}
            </div>
          );
        })}

        {threads.length === 0 ? (
          <ul className="flex-1 overflow-y-auto">
            <EmptyList folder={folder} query={loaderData.query} />
          </ul>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={threads}
            // The server renders the first rows, so the list shows before hydration.
            initialItemCount={Math.min(threads.length, 30)}
            computeItemKey={(_, thread) => threadKey(thread.accountId, thread.id)}
            endReached={loadMore}
            increaseViewportBy={400}
            className={cx("flex-1 overscroll-contain transition-opacity", loading && "opacity-50")}
            components={{ List: ThreadListElement, Item: ThreadListItem, Footer: cursor ? ListFooter : undefined }}
            context={{ loading: moreFetcher.state !== "idle", loadMore }}
            itemContent={(index, thread) => {
              const key = threadKey(thread.accountId, thread.id);
              return (
                <ThreadRow
                  index={index}
                  thread={thread}
                  href={hrefFor(thread)}
                  active={key === openKey}
                  focused={openIndex < 0 && index === focusIndex}
                  selected={selected.has(key)}
                  folder={folder}
                  accounts={
                    showAccount
                      ? threadRefs(thread).flatMap((ref) => account(ref.accountId) ?? [])
                      : []
                  }
                  onToggleSelected={() => toggleSelected(thread)}
                  onAction={(action) => act(action, [thread])}
                  menu={() => menuFor(thread)}
                  onPrefetch={(start) => prefetch(start ? thread : null)}
                />
              );
            }}
          />
        )}
      </section>

      {openKey && <ListExpandHandle />}
      <div data-list-thread className={cx("min-w-0 flex-1", openKey ? "flex" : "hidden lg:flex")}>
        <Outlet context={context} />
      </div>
    </div>
  );
}

// Keep this export apart from the declaration. The route chunk split fails on an
// inline default export that uses the list cache and has a renamed prop.
export default ThreadList;

const LIST_WIDTH_KEY = "list-width";
const LIST_MIN_WIDTH = 300;
const LIST_MAX_WIDTH = 720;
/** The thread view keeps at least this width. */
const THREAD_MIN_WIDTH = 360;
/** A drag this far past the minimum closes the list, and a drag this far out
    from a closed list opens it again. */
const LIST_COLLAPSE_DISTANCE = 64;

/** CSS variables inherit. A change on the root element recalculates the style
    of every element on the page, on each pointer move. Thus a drag changes
    the variable on the list only. The end of the drag also writes it to the
    root element, which keeps it if the list mounts again. */
function setListWidth(list: HTMLElement | null, width: number | null, save: boolean) {
  const targets = save ? [list, document.documentElement] : [list ?? document.documentElement];
  for (const target of targets) {
    if (!target) continue;
    if (width === null) target.style.removeProperty("--list-width");
    else target.style.setProperty("--list-width", `${width}px`);
  }
  if (!save) return;
  if (width === null) localStorage.removeItem(LIST_WIDTH_KEY);
  else localStorage.setItem(LIST_WIDTH_KEY, String(width));
}

/** The handle is on the line between the list and the thread view. It shows
    only when the two panes are side by side. With a thread open, a drag far
    past the minimum closes the list, as with the sidebar. */
function ListResizeHandle({
  list,
  collapsible,
}: {
  list: React.RefObject<HTMLElement | null>;
  collapsible: boolean;
}) {
  return (
    <ResizeHandle
      edge="right"
      label="Resize message list"
      min={LIST_MIN_WIDTH}
      max={() => {
        const left = list.current?.getBoundingClientRect().left ?? 0;
        return Math.min(LIST_MAX_WIDTH, window.innerWidth - left - THREAD_MIN_WIDTH);
      }}
      straddle
      className="hidden lg:block"
      size={() => list.current?.getBoundingClientRect().width ?? LIST_MIN_WIDTH}
      onResize={(width, done) => setListWidth(list.current, width, done)}
      onReset={() => setListWidth(list.current, null, true)}
      onOvershoot={
        collapsible ? { distance: LIST_COLLAPSE_DISTANCE, run: () => setListCollapsed(true) } : undefined
      }
    />
  );
}

/** With the list closed, this handle is on the left edge of the thread view.
    A drag out from the edge, an arrow key, or a double click opens the list.
    The sidebar handle is on the other side of the line, so this handle stays
    fully inside the thread view. */
function ListExpandHandle() {
  const open = () => setListCollapsed(false);
  return (
    <div className="relative hidden shrink-0 lg:in-[.list-collapsed]:block">
      <ResizeHandle
        edge="right"
        label="Show message list"
        min={0}
        max={0}
        className="translate-x-2"
        size={() => 0}
        onResize={() => {}}
        onReset={open}
        onExtend={{ distance: LIST_COLLAPSE_DISTANCE, run: open }}
      />
    </div>
  );
}

interface ListContext {
  loading: boolean;
  loadMore(): void;
}

const ThreadListElement = forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  function ThreadListElement(props, ref) {
    return <ul ref={ref} {...props} />;
  },
);

function ThreadListItem({ item: _item, ...props }: React.HTMLAttributes<HTMLLIElement> & { item: unknown }) {
  return <li {...props} />;
}

function ListFooter({ context }: { context?: ListContext }) {
  return (
    <div className="flex justify-center py-4">
      {context?.loading ? (
        <CircleNotch className="size-4 animate-spin text-zinc-400" />
      ) : (
        <button type="button" onClick={context?.loadMore} className="text-xs text-zinc-500 hover:underline">
          Load more
        </button>
      )}
    </div>
  );
}

function isRemoval(action: ThreadAction, folder: Folder) {
  return (
    (["archive", "trash", "spam", "inbox"] as ThreadAction[]).includes(action) &&
    !(action === "inbox" && folder === "inbox") &&
    !(action === folder)
  );
}

/** Shows which account (or accounts) has the conversation, in the list that shows all accounts. */
function AccountLabel({ accounts }: { accounts: AccountSummary[] }) {
  const [first, ...rest] = accounts;
  const at = first.email.lastIndexOf("@");
  const local = first.email.slice(0, at);
  const domain = first.email.slice(at + 1);
  return (
    <span
      className="flex max-w-[50%] min-w-0 shrink-0 items-center gap-1 text-[11px] text-zinc-400"
      title={accounts.map((a) => a.email).join("\n")}
    >
      <AccountIcon account={first} className="size-3" />
      {/* A long address shortens the name part only, so the domain always shows. */}
      <span className="flex min-w-0">
        <span className="truncate">{local}</span>
        <span className="shrink-0">@{domain}</span>
      </span>
      {rest.length > 0 && <span className="shrink-0">+{rest.length}</span>}
    </span>
  );
}

function ThreadRow({
  thread,
  index,
  href,
  active,
  focused,
  selected,
  folder,
  accounts,
  onToggleSelected,
  onAction,
  onPrefetch,
  menu,
}: {
  thread: ThreadSummary;
  index: number;
  href: string;
  active: boolean;
  focused: boolean;
  selected: boolean;
  folder: Folder;
  /** The accounts that have the conversation. Empty when the list shows one account. */
  accounts: AccountSummary[];
  onToggleSelected(): void;
  onAction(action: ThreadAction): void;
  /** Starts (true) or stops (false) an early load of the conversation. */
  onPrefetch(start: boolean): void;
  menu(): MenuEntry[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const people = thread.participants.slice(0, 3).map(displayName).join(", ") || "(no sender)";
  const prefix = folder === "sent" || folder === "drafts" ? "To: " : "";
  return (
    <ContextMenu items={menu} onOpenChange={setMenuOpen}>
      <div data-index={index} data-thread-key={threadKey(thread.accountId, thread.id)} className="group relative">
        <Link
          to={href}
          prefetch="intent"
          onMouseEnter={() => onPrefetch(true)}
          onMouseLeave={() => onPrefetch(false)}
          onFocus={() => onPrefetch(true)}
          className={cx(
            "tappable flex gap-3 border-b border-zinc-100 py-3 pr-4 pl-15 outline-none transition-colors dark:border-zinc-800/70",
            active
              ? "bg-accent-50 dark:bg-accent-500/10"
              : selected
                ? "bg-accent-50/60 dark:bg-accent-500/5"
                : menuOpen
                  ? "bg-zinc-100 dark:bg-zinc-800/70"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
            focused && "ring-2 ring-accent-500/60 ring-inset",
            "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {thread.unread && (
                <span
                  className={cx("size-2 shrink-0 rounded-full", accounts.length === 0 && "bg-accent-500")}
                  style={accounts.length > 0 ? { background: accounts[0].color } : undefined}
                  aria-label="Unread"
                />
              )}
              <span
                dir="auto"
                className={cx(
                  "min-w-0 truncate text-sm",
                  thread.unread ? "font-semibold text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300",
                )}
              >
                {prefix}
                {people}
              </span>
              {thread.messageCount > 1 && (
                <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{formatCount(thread.messageCount)}</span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-zinc-400 group-hover:invisible">
                {accounts.length > 1 && (
                  <span
                    className="flex -space-x-0.5"
                    role="img"
                    aria-label={`In ${accounts.length} accounts`}
                    title={accounts.map((a) => a.email).join("\n")}
                  >
                    {accounts.map((a) => (
                      <span
                        key={a.id}
                        className="size-2 rounded-full ring-1 ring-white dark:ring-zinc-950"
                        style={{ background: a.color }}
                      />
                    ))}
                  </span>
                )}
                {thread.hasAttachments && <Paperclip className="size-3" />}
                {thread.starred && <Star weight="fill" className="size-3 text-amber-400" />}
                <LocalDate iso={thread.date} format={formatListDate} />
              </span>
            </div>
            <p
              className={cx(
                "mt-0.5 truncate text-sm",
                thread.unread ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400",
              )}
            >
              <bdi>{thread.subject}</bdi>
            </p>
            {/* Keep the line when there is no preview, so every row has the same height. */}
            <div className="mt-0.5 flex items-center gap-3">
              <p dir="auto" className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                {thread.snippet.replace(/\s+/g, " ") || "\u00a0"}
              </p>
              {accounts.length > 0 && <AccountLabel accounts={accounts} />}
            </div>
          </div>
        </Link>

        <button
          type="button"
          aria-label={selected ? "Deselect conversation" : "Select conversation"}
          aria-pressed={selected}
          onClick={onToggleSelected}
          className="absolute top-3.5 left-4"
        >
          <span className={cx("block", selected && "invisible", "group-hover:invisible")}>
            <Avatar name={thread.participants[0]?.name} email={thread.participants[0]?.email ?? "?"} />
          </span>
          <span
            className={cx(
              "absolute inset-0 place-items-center rounded-full",
              selected
                ? "grid bg-accent-600 text-white"
                : "hidden bg-zinc-200 text-zinc-600 group-hover:grid dark:bg-zinc-700 dark:text-zinc-200",
            )}
          >
            <CheckSquare className="size-4" />
          </span>
        </button>

        <div className="absolute top-2 right-3 hidden items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm group-hover:flex dark:border-zinc-700 dark:bg-zinc-900">
          {folder === "archive" || folder === "trash" || folder === "spam" ? (
            <RowAction label="Move to Inbox" onClick={() => onAction("inbox")}>
              <Tray className="size-3.5" />
            </RowAction>
          ) : (
            <RowAction label="Archive" shortcut="E" onClick={() => onAction("archive")}>
              <Archive className="size-3.5" />
            </RowAction>
          )}
          {folder !== "trash" && (
            <RowAction label="Move to Trash" shortcut="#" onClick={() => onAction("trash")}>
              <Trash className="size-3.5" />
            </RowAction>
          )}
          <RowAction
            label={thread.unread ? "Mark as read" : "Mark as unread"}
            shortcut="U"
            onClick={() => onAction(thread.unread ? "read" : "unread")}
          >
            {thread.unread ? <EnvelopeSimpleOpen className="size-3.5" /> : <EnvelopeSimple className="size-3.5" />}
          </RowAction>
          <RowAction
            label={thread.starred ? "Remove star" : "Star"}
            shortcut="S"
            onClick={() => onAction(thread.starred ? "unstar" : "star")}
          >
            <Star weight={thread.starred ? "fill" : "regular"} className={cx("size-3.5", thread.starred && "text-amber-400")} />
          </RowAction>
        </div>
      </div>
    </ContextMenu>
  );
}

function RowAction({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="press grid size-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        {children}
      </button>
    </Hint>
  );
}

function BulkActions({
  count,
  folder,
  onAction,
  onClear,
  onSelectAll,
}: {
  count: number;
  folder: Folder;
  onAction(action: ThreadAction): void;
  onClear(): void;
  onSelectAll(): void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={onSelectAll} className="mr-1 text-xs font-medium text-accent-600 hover:underline">
        {count} selected
      </button>
      {folder === "inbox" || folder === "starred" ? (
        <IconButton label="Archive" shortcut="E" onClick={() => onAction("archive")}>
          <Archive className="size-4" />
        </IconButton>
      ) : (
        <IconButton label="Move to Inbox" onClick={() => onAction("inbox")}>
          <Tray className="size-4" />
        </IconButton>
      )}
      <IconButton label="Move to Trash" shortcut="#" onClick={() => onAction("trash")}>
        <Trash className="size-4" />
      </IconButton>
      <IconButton label="Mark as spam" shortcut="!" onClick={() => onAction("spam")}>
        <ShieldWarning className="size-4" />
      </IconButton>
      <IconButton label="Mark as read" onClick={() => onAction("read")}>
        <EnvelopeSimpleOpen className="size-4" />
      </IconButton>
      <IconButton label="Clear selection" shortcut="Esc" onClick={onClear}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

function EmptyList({ folder, query }: { folder: Folder; query: string }) {
  if (query) {
    return (
      <li className="px-6 py-16 text-center text-sm text-zinc-500">
        No conversations match “{query}”.
      </li>
    );
  }
  if (folder === "inbox") {
    return (
      <li className="flex flex-col items-center gap-2 px-6 py-20 text-center">
        <span className="text-4xl">🌤️</span>
        <p className="font-medium">Inbox zero</p>
        <p className="text-sm text-zinc-500">You are all caught up.</p>
      </li>
    );
  }
  return (
    <li className="px-6 py-16 text-center text-sm text-zinc-500">
      {FOLDER_LABELS[folder]} is empty.
    </li>
  );
}
