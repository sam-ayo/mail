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
  Megaphone,
  NotePencil,
  Paperclip,
  ShieldWarning,
  Star,
  Trash,
  Tray,
  Warning,
  X,
} from "~/components/icons";
import { forwardRef, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  Await,
  data,
  Form,
  Link,
  matchPath,
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
import { toast } from "sonner";
import type { MenuEntry } from "~/components/menu";
import { ContextMenu, copyText, openContextMenuAt } from "~/components/menu";
import { setListCollapsed } from "~/components/list-panel";
import { SINGLE_PANE, useMediaQuery, usePaneSwipeBack, usePullToRefresh, useRowSwipe } from "~/components/touch";
import { ResizeHandle } from "~/components/resize-handle";
import { reconnectUrl } from "~/components/sidebar";
import { AccountIcon, Avatar, Hint, IconButton, cx } from "~/components/ui";
import type { AccountSummary, Folder, ThreadAction, ThreadCategory, ThreadSummary } from "~/lib/mail";
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
import { waitUntil } from "@vercel/functions";
import { userContext } from "~/server/context";
import { listThreads } from "~/server/mail.server";
import { sortListed, withCategories } from "~/server/triage.server";
import type { Route } from "./+types/mail.list";

export function loader({ params, request, context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  if (!isFolder(params.folder)) throw data("Folder not found", { status: 404 });
  if (params.scope !== "all" && !user.accounts.some((a) => a.id === params.scope)) {
    throw data("Account not found", { status: 404 });
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  // The mail servers can take a few seconds. The loader does not wait for
  // them, so the page streams: its frame shows first, and the rows follow.
  const list = listThreads(
    user.id,
    { scope: params.scope, folder: params.folder, query, cursor: url.searchParams.get("cursor") },
    user.accounts,
  ).then(async (result) => {
    // The inbox shows important mail and promotions in two tabs.
    if (params.folder !== "inbox" || query) return { ...result, query };
    const threads = await withCategories(result.threads);
    // Mail that the mail check did not sort, such as older or read mail, shows in the next load.
    waitUntil(sortListed(user.id, threads).catch((error) => console.error("Cannot sort the inbox", error)));
    return { ...result, threads, query };
  });
  return { list };
}

type ListData = Awaited<ReturnType<typeof loader>["list"]>;

/** Loads the list from the server, and waits for the streamed rows. */
async function loadList(serverLoader: Route.ClientLoaderArgs["serverLoader"]): Promise<ListData> {
  return (await serverLoader()).list;
}
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
/** The pause in typing before a search runs. Each search asks the mail servers. */
const SEARCH_DELAY_MS = 400;
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

/**
 * Keeps the rows of each account that failed to load. A short error, such as
 * a Gmail rate limit during a check for new mail, then does not empty its list.
 */
function keepFailedRows(data: ListData, previous: ListData | undefined): ListData {
  if (!previous || data.errors.length === 0) return data;
  const failed = new Set(data.errors.map((error) => error.accountId));
  const kept = previous.threads.filter((thread) => failed.has(thread.accountId));
  if (kept.length === 0) return data;
  const threads = [...data.threads, ...kept].sort((a, b) => b.date.localeCompare(a.date));
  return { ...data, threads };
}

function fetchList(key: string, serverLoader: () => Promise<ListData>) {
  const previous = listCache.get(key);
  const pending = serverLoader().then(
    (loaded) => {
      const data = keepFailedRows(loaded, previous?.data);
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
  if (url.searchParams.has("cursor")) return { ...(await loadList(serverLoader)), loadedAt: Date.now() };
  const key = listKey(params.scope, params.folder, url.searchParams.get("q")?.trim() ?? "");
  const prefetch = url.searchParams.has(PREFETCH_PARAM);
  const entry = listCache.get(key);

  if (entry?.data && key !== shownListKey) {
    const refresh =
      Date.now() - entry.at > (prefetch ? PREFETCH_FRESH_MS : LIST_FRESH_MS)
        ? (entry.pending ?? fetchList(key, () => loadList(serverLoader))).then(
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
  const load = fetchList(key, () => loadList(serverLoader)).then((data) => ({ ...data, loadedAt: Date.now() }));
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
  { title: `${isFolder(params.folder) ? FOLDER_LABELS[params.folder] : "Mail"} · mail by samayo` },
];

export interface ListOutletContext {
  folder: Folder;
  threads: ThreadSummary[];
  /** Runs an action on the open conversation, then opens the next one if needed. */
  actOnOpenThread(action: ThreadAction): void;
  openRelative(offset: 1 | -1): void;
  closeThread(): void;
}

/** The list data after the client loader, or the streamed list of the server render. */
type ShownListData = ListData & {
  loadedAt?: number;
  refresh?: Promise<(ListData & { loadedAt: number }) | null>;
};

function ThreadListRoute({ loaderData, params }: Route.ComponentProps) {
  // Only the server render has the list as a promise. In the browser, the
  // client loader waits for it, so the Await below renders at once.
  const list = "list" in loaderData ? loaderData.list : loaderData;
  const folder = params.folder as Folder;
  return (
    <Suspense fallback={<ListSkeleton folder={folder} />}>
      <Await resolve={list}>
        {(resolved: ShownListData) => <ThreadList loaderData={resolved} params={params} />}
      </Await>
    </Suspense>
  );
}

/**
 * The frame of the list, while the rows stream from the server. It has the
 * size of the real list, so the page does not move when the rows arrive.
 */
function ListSkeleton({ folder }: { folder: Folder }) {
  const bar = "animate-pulse rounded bg-zinc-100 dark:bg-zinc-800";
  return (
    <div aria-busy="true" className="relative flex min-w-0 flex-1 overflow-hidden">
      <section className="relative flex w-full min-w-0 flex-col border-zinc-200 lg:w-[var(--list-width,420px)] lg:shrink-0 lg:border-r xl:w-[var(--list-width,460px)] dark:border-zinc-800">
        <header className="flex flex-col gap-3 border-b border-zinc-200 px-4 pt-4 pb-3 dark:border-zinc-800 md:in-[.sidebar-collapsed]:pl-14">
          <div className="flex h-8 items-center gap-2">
            <span className="size-8 md:hidden" />
            <h1 className="truncate text-lg font-semibold tracking-tight max-md:text-2xl max-md:font-bold">
              {FOLDER_LABELS[folder]}
            </h1>
          </div>
          <div className="h-[34px] rounded-lg bg-zinc-100 dark:bg-zinc-900" />
        </header>
        <ul className="flex-1 overflow-hidden bg-white dark:bg-zinc-950">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="flex gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
              <div className={cx("size-8 shrink-0 rounded-full", bar)} />
              <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                <div className={cx("h-3.5 w-1/3", bar)} />
                <div className={cx("h-3 w-3/4", bar)} />
                <div className={cx("h-3 w-1/2", bar)} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="hidden min-w-0 flex-1 bg-zinc-50/50 lg:flex dark:bg-zinc-950" />
    </div>
  );
}

function ThreadList({
  loaderData: routeData,
  params,
}: {
  loaderData: ShownListData;
  params: Route.ComponentProps["params"];
}) {
  const { scope } = params;
  const folder = params.folder as Folder;

  // A cached list shows first. Newer data from the server replaces it when it arrives.
  const [fresh, setFresh] = useState<{ from: typeof routeData; data: ListData; loadedAt: number }>();
  useEffect(() => {
    if (!routeData.refresh) return;
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
  const loadedAt = current?.loadedAt ?? routeData.loadedAt ?? renderedAt;

  const shownKey = listKey(scope, folder, loaderData.query);
  useEffect(() => {
    // The server render does not go through the client loader. Keep its list too.
    if (!listCache.has(shownKey)) rememberList(shownKey, loaderData, loadedAt);
    shownListKey = shownKey;
    return () => {
      if (shownListKey === shownKey) shownListKey = null;
    };
  }, [shownKey, loaderData, loadedAt]);

  const { accounts, account, patches, runAction, openCompose, refreshCounts } = useMail();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const childParams = useParams();
  const moreFetcher = useFetcher<typeof clientLoader>();
  const searchRef = useRef<HTMLInputElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const listRef = useRef<HTMLElement>(null);
  const pullIndicator = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

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

  // AI sorting puts promotions in their own tab of the inbox. Mail with no
  // category shows with the important mail, so that no mail stays hidden.
  const sorted = folder === "inbox" && !loaderData.query;
  const [tab, setTab] = useState<ThreadCategory>("important");
  const [moved, setMoved] = useState<Record<string, ThreadCategory>>({});

  const allThreads = useMemo(() => {
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

  const categoryOf = (thread: ThreadSummary): ThreadCategory =>
    moved[threadKey(thread.accountId, thread.id)] ?? thread.category ?? "important";
  const threads = useMemo(
    () => (sorted ? allThreads.filter((thread) => categoryOf(thread) === tab) : allThreads),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allThreads, sorted, tab, moved],
  );

  const base = `/mail/${scope}/${folder}`;
  const openKey =
    childParams.accountId && childParams.threadId
      ? threadKey(childParams.accountId, childParams.threadId)
      : null;
  const openIndex = openKey
    ? threads.findIndex((t) => threadKey(t.accountId, t.id) === openKey)
    : -1;

  // The conversation that loads now. Its row shows as open at once, before
  // the server answers. A conversation that is not in the cache can take a
  // second to load.
  const pendingParams =
    navigation.state === "loading"
      ? matchPath(`${base}/:accountId/:threadId`, navigation.location.pathname)?.params
      : undefined;
  const pendingKey =
    pendingParams?.accountId && pendingParams.threadId
      ? threadKey(pendingParams.accountId, pendingParams.threadId)
      : null;
  const selectedKey = pendingKey ?? openKey;
  // A cached conversation loads in a few milliseconds. On a wide screen, the
  // placeholder shows only after a short wait, so it does not flash before a
  // fast load. On a narrow screen, the list stays until the pane shows, so
  // the placeholder shows at once.
  const [slowKey, setSlowKey] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingKey || pendingKey === openKey) return;
    const wide = window.matchMedia("(min-width: 64rem)").matches;
    const timer = setTimeout(() => setSlowKey(pendingKey), wide ? 100 : 0);
    return () => clearTimeout(timer);
  }, [pendingKey, openKey]);
  const loadingThread =
    pendingKey && pendingKey !== openKey && slowKey === pendingKey
      ? threads.find((t) => threadKey(t.accountId, t.id) === pendingKey)
      : undefined;

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
  const hrefFor = (thread: ThreadSummary) => `${base}/${thread.accountId}/${thread.id}${search}`;
  const prefetchHref = (thread: ThreadSummary) =>
    `${hrefFor(thread)}${search ? "&" : "?"}${PREFETCH_PARAM}`;
  const openThread = (thread: ThreadSummary | undefined) => thread && navigate(hrefFor(thread));
  const closeThread = () => navigate(`${base}${search}`);

  // Below lg, the conversation is a pane over the list, as a pushed screen in
  // iOS. It slides in, and a swipe from the left edge or the back button
  // slides it out. The list stays under it, so it keeps its scroll position.
  const singlePane = useMediaQuery(SINGLE_PANE);
  const paneOpen = Boolean(openKey || loadingThread);
  const swipeBack = usePaneSwipeBack({ enabled: singlePane && paneOpen, onBack: closeThread });
  const resetPane = swipeBack.reset;
  const [pushing, setPushing] = useState(false);
  const wasOpen = useRef(paneOpen);
  useLayoutEffect(() => {
    if (paneOpen && !wasOpen.current && singlePane) setPushing(true);
    if (!paneOpen) resetPane();
    wasOpen.current = paneOpen;
  }, [paneOpen, singlePane, resetPane]);

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

  // A tab can show only a few rows of each page. Load more pages to fill it,
  // but not the full inbox: each page asks the mail servers.
  const tabLoads = useRef(0);
  useEffect(() => {
    tabLoads.current = 0;
  }, [tab, loaderData]);
  useEffect(() => {
    if (!sorted || threads.length >= 15 || !cursor || moreFetcher.state !== "idle") return;
    if (tabLoads.current >= 4) return;
    tabLoads.current += 1;
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, threads.length, cursor, moreFetcher.state]);

  /** Moves conversations to the other tab. AI sorting then puts later mail from the same senders there too. */
  async function moveTo(category: ThreadCategory, rows: ThreadSummary[]) {
    const targets = rows.flatMap((thread) =>
      threadRefs(thread).map((ref) => ({ ...ref, sender: thread.participants[0]?.email })),
    );
    const keys = targets.map((t) => threadKey(t.accountId, t.threadId));
    const previous = { ...moved };
    setMoved((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, category])) }));
    setSelected(new Set());
    if (openKey && keys.includes(openKey)) closeThread();
    const label = category === "promotion" ? "Promotions" : "Important";
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, targets }),
      });
      if (!response.ok) throw new Error(String(response.status));
      refreshCounts();
      toast.success(rows.length === 1 ? `Moved to ${label}` : `Moved ${rows.length} conversations to ${label}`);
    } catch {
      setMoved(previous);
      toast.error(`Could not move to ${label}`);
    }
  }

  // A search runs after a short pause in the typing. Enter runs it at once.
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function searchSoon(value: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const query = value.trim();
      if (query === loaderData.query) return;
      // Each new search replaces the last one in the history, so Back leaves the search.
      navigate(query ? `${base}?q=${encodeURIComponent(query)}` : base, {
        replace: Boolean(loaderData.query),
      });
    }, SEARCH_DELAY_MS);
  }
  // A search from a menu changes the text in the box. The text that you type stays.
  useEffect(() => {
    const input = searchRef.current;
    if (input && document.activeElement !== input) input.value = loaderData.query;
  }, [loaderData.query]);

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
      sorted && {
        label: tab === "promotion" ? `Move to Important${count}` : `Move to Promotions${count}`,
        icon: tab === "promotion" ? Tray : Megaphone,
        onSelect: () => moveTo(tab === "promotion" ? "important" : "promotion", rows),
      },
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
    closeThread: singlePane ? swipeBack.back : closeThread,
  };

  const scopeAccount = scope === "all" ? undefined : account(scope);
  const showAccount = scope === "all" && accounts.length > 1;
  const loading =
    navigation.state === "loading" &&
    navigation.location.pathname.split("/").slice(0, 4).join("/") !== base;
  // A search goes to the same list with a new query.
  const searching =
    navigation.state === "loading" &&
    navigation.location.pathname === base &&
    (new URLSearchParams(navigation.location.search).get("q") ?? "") !== loaderData.query;
  const refreshing = revalidator.state === "loading";
  usePullToRefresh({ scroller, indicator: pullIndicator, refreshing, onRefresh: () => revalidator.revalidate() });

  return (
    // The list slides out past the left edge of this pane, which clips it.
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      <section
        ref={listRef}
        data-list
        className={cx(
          "relative flex min-w-0 flex-col border-zinc-200 lg:border-r dark:border-zinc-800",
          // The resize handle sets --list-width. Without it, the default width applies.
          "w-full lg:w-[var(--list-width,420px)] lg:shrink-0 xl:w-[var(--list-width,460px)]",
          paneOpen && "lg:in-[.list-collapsed]:hidden",
        )}
        // The conversation covers the list on a narrow screen.
        inert={singlePane && paneOpen}
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
              <h1 className="truncate text-lg font-semibold tracking-tight max-md:text-2xl max-md:font-bold">
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
              // A touch screen has pull-to-refresh instead.
              <IconButton
                label="Check for new mail"
                className="pointer-coarse:hidden"
                onClick={() => revalidator.revalidate()}
                disabled={refreshing}
              >
                <ArrowClockwise className={cx("size-4", refreshing && "animate-spin")} />
              </IconButton>
            )}
          </div>
          <Form
            method="get"
            action={base}
            className="relative"
            onSubmit={() => clearTimeout(searchTimer.current)}
          >
            {searching ? (
              <CircleNotch
                aria-label="Searching"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-zinc-400"
              />
            ) : (
              <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
            )}
            <input
              ref={searchRef}
              key={base}
              name="q"
              type="search"
              enterKeyHint="search"
              defaultValue={loaderData.query}
              placeholder={`Search ${scopeAccount ? scopeAccount.email : "all mail"}`}
              onChange={(event) => searchSoon(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  clearTimeout(searchTimer.current);
                  event.currentTarget.blur();
                  if (loaderData.query) navigate(base);
                }
              }}
              className="w-full rounded-lg border border-transparent bg-zinc-100 py-1.5 pr-10 pl-9 text-sm outline-none transition-[background-color,border-color,box-shadow] placeholder:text-zinc-400 focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/20 dark:bg-zinc-900 dark:focus:bg-zinc-900"
            />
            <kbd className="absolute top-1/2 right-2.5 -translate-y-1/2">/</kbd>
          </Form>
          {sorted && (
            <InboxTabs
              tab={tab}
              onChange={(next) => {
                setTab(next);
                setSelected(new Set());
                setFocusIndex(0);
                if (openKey) closeThread();
              }}
            />
          )}
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

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={pullIndicator}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-3 flex justify-center opacity-0"
          >
            <ArrowClockwise className="size-5 rotate-(--pull-turn) text-zinc-400 in-[[data-refreshing]]:animate-spin" />
          </div>
          {threads.length === 0 ? (
            <ul
              ref={setScroller}
              aria-busy={searching}
              className={cx(
                "flex-1 overflow-y-auto overscroll-contain bg-white transition-opacity dark:bg-zinc-950",
                searching && "opacity-50",
              )}
            >
              <EmptyList folder={folder} query={loaderData.query} promotions={sorted && tab === "promotion"} />
            </ul>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              scrollerRef={(element) => setScroller(element instanceof HTMLElement ? element : null)}
              data={threads}
              // The server renders the first rows, so the list shows before hydration.
              initialItemCount={Math.min(threads.length, 30)}
              computeItemKey={(_, thread) => threadKey(thread.accountId, thread.id)}
              endReached={loadMore}
              increaseViewportBy={400}
              aria-busy={loading || searching}
              className={cx(
                "flex-1 overscroll-contain bg-white transition-opacity dark:bg-zinc-950",
                (loading || searching) && "opacity-50",
              )}
              components={{ List: ThreadListElement, Item: ThreadListItem, Footer: cursor ? ListFooter : undefined }}
              context={{ loading: moreFetcher.state !== "idle", loadMore }}
              itemContent={(index, thread) => {
                const key = threadKey(thread.accountId, thread.id);
                return (
                  <ThreadRow
                    index={index}
                    thread={thread}
                    href={hrefFor(thread)}
                    active={key === selectedKey}
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
                    prefetchHref={prefetchHref(thread)}
                  />
                );
              }}
            />
          )}
          {/* On a phone, "New message" floats above the list, near the thumb, as the reply actions do. */}
          <button
            type="button"
            aria-label="New message"
            title="New message"
            onClick={() => openCompose()}
            className="press absolute right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] inline-flex size-14 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg shadow-accent-600/30 md:hidden"
          >
            <NotePencil className="size-6" />
          </button>
        </div>

      </section>

      {(openKey || loadingThread) && <ListExpandHandle />}
      <div
        ref={swipeBack.pane}
        data-list-thread
        onAnimationEnd={() => setPushing(false)}
        className={cx(
          "min-w-0 flex-1",
          paneOpen
            ? "flex max-lg:absolute max-lg:inset-0 max-lg:z-10 max-lg:shadow-[-1px_0_16px_rgb(0_0_0/0.12)]"
            : "hidden lg:flex",
          pushing && "max-lg:motion-safe:animate-[pane-push_320ms_var(--ease-drawer)]",
        )}
      >
        {loadingThread ? <ThreadPlaceholder thread={loadingThread} /> : <Outlet context={context} />}
      </div>
    </div>
  );
}

/**
 * Shows in the conversation pane while a conversation loads from the server.
 * The list row gives the subject, so it shows at once. The row does not tell
 * who sent the newest message, so the message card has no name.
 */
function ThreadPlaceholder({ thread }: { thread: ThreadSummary }) {
  const bar = "animate-pulse rounded bg-zinc-100 dark:bg-zinc-800";
  return (
    <article aria-busy="true" className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
      {/* The same height as the header of the conversation. */}
      <header className="h-[49px] shrink-0 border-b border-zinc-200 dark:border-zinc-800" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <h1 dir="auto" className="mb-6 text-xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">
            {thread.subject}
          </h1>
          <div className="flex items-start gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className={cx("size-8 shrink-0 rounded-full", bar)} />
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              <div className={cx("h-3.5 w-1/4", bar)} />
              <div className={cx("h-3 w-2/3", bar)} />
              <div className={cx("h-3 w-1/2", bar)} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

// Keep this export apart from the declaration. The route chunk split fails on an
// inline default export that uses the list cache and has a renamed prop.
export default ThreadListRoute;

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

// A conversation loads when its row stays on the screen, so it opens with its
// messages and pictures. A touch screen has no hover, so it needs this most.
const SHOWN_DELAY_MS = 400;
// Each load uses provider quota. A shown conversation loads again only after this time.
const SHOWN_FRESH_MS = 5 * 60_000;
const shownLoads = new Map<string, number>();

/** Loads the conversation when the row stays on the screen. `version` changes with a new message. */
function useLoadWhenShown(row: RefObject<HTMLElement | null>, href: string, version: string) {
  const fetcher = useFetcher();
  const loading = useRef(false);
  useEffect(() => {
    if (fetcher.state === "idle") loading.current = false;
  }, [fetcher.state]);
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (!entry.isIntersecting) return;
      timer = setTimeout(() => {
        const at = shownLoads.get(version);
        if (at && Date.now() - at < SHOWN_FRESH_MS) return;
        shownLoads.set(version, Date.now());
        loading.current = true;
        fetcher.load(href);
      }, SHOWN_DELAY_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      // A row that goes away stops its load. Then the next show loads again.
      if (loading.current) shownLoads.delete(version);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, version]);
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
  prefetchHref,
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
  /** The URL that loads the conversation early. */
  prefetchHref: string;
  menu(): MenuEntry[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLoadWhenShown(rowRef, prefetchHref, `${threadKey(thread.accountId, thread.id)}:${thread.date}:${thread.messageCount}`);
  // A swipe to the left archives, or moves back to the inbox. A swipe to the
  // right marks the conversation as read or unread.
  const restore = folder === "archive" || folder === "trash" || folder === "spam";
  const leftAction: ThreadAction = restore ? "inbox" : "archive";
  const stopSwipeClick = useRowSwipe({
    row: rowRef,
    content: contentRef,
    left: { removes: isRemoval(leftAction, folder), run: () => onAction(leftAction) },
    right: { removes: false, run: () => onAction(thread.unread ? "read" : "unread") },
  });
  const people = thread.participants.slice(0, 3).map(displayName).join(", ") || "(no sender)";
  const prefix = folder === "sent" || folder === "drafts" ? "To: " : "";
  return (
    <ContextMenu items={menu} onOpenChange={setMenuOpen}>
      <div
        ref={rowRef}
        data-index={index}
        data-thread-key={threadKey(thread.accountId, thread.id)}
        className="group relative touch-pan-y"
      >
        {/* The colors under the row show while it moves. */}
        <div
          aria-hidden
          className="absolute inset-0 hidden items-center justify-start gap-2 bg-sky-500 pl-6 text-sm font-medium text-white group-data-[swipe=right]:flex"
        >
          {thread.unread ? <EnvelopeSimpleOpen className="size-5" /> : <EnvelopeSimple className="size-5" />}
          {thread.unread ? "Read" : "Unread"}
        </div>
        <div
          aria-hidden
          className="absolute inset-0 hidden items-center justify-end gap-2 bg-violet-500 pr-6 text-sm font-medium text-white group-data-[swipe=left]:flex"
        >
          {restore ? "Inbox" : "Archive"}
          {restore ? <Tray className="size-5" /> : <Archive className="size-5" />}
        </div>
        <div ref={contentRef} className="relative bg-white dark:bg-zinc-950">
          <Link
            to={href}
            prefetch="intent"
            onMouseEnter={() => onPrefetch(true)}
            onMouseLeave={() => onPrefetch(false)}
            // A touch screen has no hover. Load when the finger touches the row.
            // A scroll cancels the touch, and the load does not start.
            onPointerDown={(event) => event.pointerType !== "mouse" && onPrefetch(true)}
            onPointerCancel={() => onPrefetch(false)}
            onFocus={() => onPrefetch(true)}
            onClickCapture={stopSwipeClick}
            className={cx(
              "tappable flex gap-3 border-b border-zinc-100 py-3 pr-4 pl-15 outline-none transition-colors dark:border-zinc-800/70",
              active
                ? "bg-accent-50 dark:bg-accent-500/10"
                : selected
                  ? "bg-accent-50/60 dark:bg-accent-500/5"
                  : menuOpen
                    ? "bg-zinc-100 dark:bg-zinc-800/70"
                    : "hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-900",
              // The keyboard cursor. A touch screen has no keyboard cursor.
              focused && "pointer-fine:ring-2 pointer-fine:ring-accent-500/60 pointer-fine:ring-inset",
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

function EmptyList({ folder, query, promotions }: { folder: Folder; query: string; promotions: boolean }) {
  if (promotions) {
    return (
      <li className="px-6 py-16 text-center text-sm text-zinc-500">No promotions</li>
    );
  }
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

/** The two tabs of the sorted inbox. */
function InboxTabs({
  tab,
  onChange,
}: {
  tab: ThreadCategory;
  onChange(tab: ThreadCategory): void;
}) {
  const tabs: { value: ThreadCategory; label: string }[] = [
    { value: "important", label: "Important" },
    { value: "promotion", label: "Promotions" },
  ];
  return (
    <div role="tablist" aria-label="Inbox" className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
      {tabs.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => onChange(value)}
          className={cx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors",
            tab === value
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
