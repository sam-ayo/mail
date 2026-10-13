import {
  Archive,
  ArrowBendDoubleUpLeft,
  ArrowBendUpLeft,
  ArrowBendUpRight,
  ArrowLeft,
  ArrowsInLineVertical,
  BellSlash,
  CaretDown,
  CaretUp,
  Copy,
  DotsThree,
  DownloadSimple,
  EnvelopeSimple,
  FileText,
  Info,
  ShieldWarning,
  Star,
  Trash,
  Tray,
} from "@phosphor-icons/react";
import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useMemo, useState } from "react";
import { data, isRouteErrorResponse, useOutletContext, useRouteError } from "react-router";
import { Composer, formatSize } from "~/components/composer";
import { EmailFrame } from "~/components/email-frame";
import { LocalDate } from "~/components/local-date";
import { UnsubscribeDialog, isUnsubscribed } from "~/components/unsubscribe-dialog";
import { useHotkeys } from "~/components/hotkeys";
import { applyPatch, replyRequest, useMail } from "~/components/mail-context";
import { ContextMenu, copyText } from "~/components/menu";
import { Avatar, FileName, Hint, IconButton, PROVIDER_NAMES, cx } from "~/components/ui";
import type { ComposeDraft } from "~/lib/compose";
import { draftFor } from "~/lib/compose";
import type { RenderedMessage, RenderedThread } from "~/lib/mail";
import { attachmentUrl, displayName, PREFETCH_PARAM, formatAddress, formatFullDate, threadKey, threadRefs } from "~/lib/mail";
import { userContext } from "~/server/context";
import { loadThread } from "~/server/mail.server";
import { ProviderAuthError, ProviderError } from "~/server/providers/types";
import { errorMessage } from "~/server/util.server";
import type { Route } from "./+types/mail.thread";
import type { ListOutletContext } from "./mail.list";

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = context.get(userContext)!;
  try {
    const thread = await loadThread(user.id, params.accountId, params.threadId);
    return { thread };
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      throw data("This conversation no longer exists. Someone may have deleted or moved it.", {
        status: 404,
      });
    }
    if (error instanceof ProviderAuthError) {
      throw data("This account needs you to sign in again.", { status: 401 });
    }
    throw data(`Could not load the conversation: ${errorMessage(error)}`, { status: 502 });
  }
}

type ThreadData = Awaited<ReturnType<typeof loader>>;
interface CacheEntry {
  data?: ThreadData;
  /** Time the data loaded. */
  at: number;
  pending?: Promise<ThreadData>;
}

// Conversations that loaded before. A conversation that you open again, or
// that loaded early on hover, shows with no wait for the server.
const threadCache = new Map<string, CacheEntry>();
const CACHE_LIMIT = 100;
/** Cached data older than this shows at once, then reloads in the background. */
const STALE_MS = 30_000;
/** The conversation on the screen. A reload of it always asks the server. */
let shownKey: string | null = null;

function fetchThread(key: string, serverLoader: () => Promise<ThreadData>) {
  const previous = threadCache.get(key);
  const pending: Promise<ThreadData> = serverLoader().then(
    (data) => {
      threadCache.delete(key);
      threadCache.set(key, { data, at: Date.now() });
      if (threadCache.size > CACHE_LIMIT) threadCache.delete(threadCache.keys().next().value!);
      return data;
    },
    (error) => {
      if (threadCache.get(key)?.pending === pending) {
        if (previous?.data) threadCache.set(key, { data: previous.data, at: previous.at });
        else threadCache.delete(key);
      }
      throw error;
    },
  );
  threadCache.set(key, { data: previous?.data, at: previous?.at ?? 0, pending });
  return pending;
}

export async function clientLoader(args: Route.ClientLoaderArgs) {
  if (!new URL(args.request.url).searchParams.has(PREFETCH_PARAM)) return loadCached(args);
  // An error from a fetcher replaces the full page, so a failed prefetch
  // stays silent. The fetchers do not use the data. If you open the
  // conversation, the error shows in the conversation pane.
  return loadCached(args).catch(() => null as never);
}

async function loadCached({ params, request, serverLoader }: Route.ClientLoaderArgs) {
  const key = threadKey(params.accountId, params.threadId);
  const entry = threadCache.get(key);

  if (entry?.data && key !== shownKey) {
    const refresh =
      Date.now() - entry.at > STALE_MS
        ? (entry.pending ?? fetchThread(key, serverLoader)).then(
            (data) => ({ ...data, loadedAt: Date.now() }),
            () => null,
          )
        : undefined;
    return { ...entry.data, loadedAt: entry.at, refresh };
  }

  if (entry?.pending && key !== shownKey) {
    // A hover prefetch can stop before it completes. Then load again.
    try {
      return { ...(await entry.pending), loadedAt: Date.now() };
    } catch (error) {
      if (request.signal.aborted) throw error;
    }
  }

  return { ...(await fetchThread(key, serverLoader)), loadedAt: Date.now() };
}

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.thread.subject ?? "Conversation"} · mail` },
];

type ReplyMode = "reply" | "replyAll" | "forward";

export default function ThreadView({ loaderData }: Route.ComponentProps) {
  const { account, patches, runAction } = useMail();
  const list = useOutletContext<ListOutletContext>();

  // Cached data shows first. Newer data from the server replaces it when it arrives.
  const [fresh, setFresh] = useState<{ from: typeof loaderData; thread: RenderedThread; loadedAt: number }>();
  useEffect(() => {
    if (!("refresh" in loaderData) || !loaderData.refresh) return;
    let live = true;
    loaderData.refresh.then((result) => {
      if (live && result) setFresh({ from: loaderData, thread: result.thread, loadedAt: result.loadedAt });
    });
    return () => {
      live = false;
    };
  }, [loaderData]);
  const current = fresh?.from === loaderData ? fresh : null;
  const data = current?.thread ?? loaderData.thread;

  const key = threadKey(data.accountId, data.id);
  const owner = account(data.accountId);
  const firstRender = useMemo(() => Date.now(), [loaderData]);
  const loadedAt = current?.loadedAt ?? ("loadedAt" in loaderData ? loaderData.loadedAt : firstRender);
  const thread = applyPatch(data, patches[key], loadedAt);

  useEffect(() => {
    shownKey = key;
    return () => {
      if (shownKey === key) shownKey = null;
    };
  }, [key]);

  // Mark the conversation as read when it opens, in every account that has a copy.
  useEffect(() => {
    const row = list.threads.find((t) => threadKey(t.accountId, t.id) === key);
    if (data.unread || row?.unread) {
      runAction(row ? threadRefs(row) : [{ accountId: data.accountId, threadId: data.id }], "read", {
        quiet: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Show unread messages and the newest message. Collapse the others.
  const initialExpanded = () =>
    new Set([
      ...data.messages.filter((m) => m.unread).map((m) => m.id),
      data.messages[data.messages.length - 1]?.id,
    ]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [expandedFor, setExpandedFor] = useState(key);
  const [knownIds, setKnownIds] = useState(() => data.messages.map((m) => m.id).join());
  const messageIds = data.messages.map((m) => m.id).join();
  if (expandedFor !== key) {
    setExpandedFor(key);
    setExpanded(initialExpanded());
    setKnownIds(messageIds);
  } else if (knownIds !== messageIds) {
    // Expand messages that arrive while the conversation is open.
    const known = new Set(knownIds.split(","));
    setKnownIds(messageIds);
    setExpanded((current) => new Set([...current, ...data.messages.filter((m) => !known.has(m.id)).map((m) => m.id)]));
  }

  const replyStorageKey = `relay:reply:${key}`;
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  useEffect(() => {
    const saved = localStorage.getItem(replyStorageKey);
    setDraft(saved ? JSON.parse(saved) : null);
  }, [replyStorageKey]);

  function saveDraft(next: ComposeDraft | null) {
    setDraft(next);
    if (next) localStorage.setItem(replyStorageKey, JSON.stringify(next));
    else localStorage.removeItem(replyStorageKey);
  }

  function startReply(mode: ReplyMode, message?: RenderedMessage) {
    if (!owner) return;
    const target = message ?? data.messages[data.messages.length - 1];
    if (!target) return;
    saveDraft(draftFor(mode, target, owner));
    requestAnimationFrame(() =>
      document.getElementById("reply-composer")?.scrollIntoView({ behavior: "smooth", block: "end" }),
    );
  }

  // A reply that started from the list menu before the conversation opened.
  useEffect(() => {
    if (replyRequest.current?.key !== key) return;
    const { mode } = replyRequest.current;
    replyRequest.current = null;
    startReply(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The shortcuts open and close all messages at once, many times a day.
  // They change the messages with no animation. A click animates.
  const [instant, setInstant] = useState(false);
  useHotkeys({
    ";": () => {
      setInstant(true);
      setExpanded(new Set(data.messages.map((m) => m.id)));
    },
    ":": () => {
      setInstant(true);
      setExpanded(new Set());
    },
  });

  // Shortcuts r, a, and f in the list route send this event.
  useEffect(() => {
    const onReply = (event: Event) => startReply((event as CustomEvent<ReplyMode>).detail);
    window.addEventListener("mail:reply", onReply);
    return () => window.removeEventListener("mail:reply", onReply);
  });

  const removalActions =
    list.folder === "archive" || list.folder === "trash" || list.folder === "spam";
  const index = list.threads.findIndex((t) => threadKey(t.accountId, t.id) === key);

  return (
    <article className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
      {/* Below lg, the thread fills the main area. With the sidebar collapsed,
          the header then moves away from the sidebar button. */}
      <header className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2 transition-[padding] duration-(--sidebar-duration) ease-spring motion-reduce:transition-none dark:border-zinc-800 md:max-lg:in-[.sidebar-collapsed]:pl-14">
        <IconButton label="Back to the list" shortcut="Esc" onClick={list.closeThread}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        {removalActions ? (
          <IconButton label="Move to Inbox" onClick={() => list.actOnOpenThread("inbox")}>
            <Tray className="size-4" />
          </IconButton>
        ) : (
          <IconButton label="Archive" shortcut="E" onClick={() => list.actOnOpenThread("archive")}>
            <Archive className="size-4" />
          </IconButton>
        )}
        {list.folder !== "trash" && (
          <IconButton label="Move to Trash" shortcut="#" onClick={() => list.actOnOpenThread("trash")}>
            <Trash className="size-4" />
          </IconButton>
        )}
        {list.folder !== "spam" && (
          <IconButton label="Mark as spam" shortcut="!" onClick={() => list.actOnOpenThread("spam")}>
            <ShieldWarning className="size-4" />
          </IconButton>
        )}
        <IconButton label="Mark as unread" shortcut="U" onClick={() => list.actOnOpenThread("unread")}>
          <EnvelopeSimple className="size-4" />
        </IconButton>
        <IconButton
          label={thread.starred ? "Remove star" : "Star"}
          shortcut="S"
          onClick={() => list.actOnOpenThread(thread.starred ? "unstar" : "star")}
        >
          <Star weight={thread.starred ? "fill" : "regular"} className={cx("size-4", thread.starred && "text-amber-400")} />
        </IconButton>
        <div className="flex-1" />
        {index >= 0 && (
          <span className="mr-1 text-xs text-zinc-400 tabular-nums">
            {index + 1} of {list.threads.length}
          </span>
        )}
        <IconButton label="Previous conversation" shortcut="K" disabled={index <= 0} onClick={() => list.openRelative(-1)}>
          <CaretUp className="size-4" />
        </IconButton>
        <IconButton
          label="Next conversation"
          shortcut="J"
          disabled={index < 0 || index >= list.threads.length - 1}
          onClick={() => list.openRelative(1)}
        >
          <CaretDown className="size-4" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* The subject gets the full width. A long subject must not wrap into
              a narrow column next to the account badge. */}
          <div className="mb-6 space-y-2">
            <h1 dir="auto" className="text-xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">
              {thread.subject}
            </h1>
            {owner && (
              <span
                title={owner.email}
                className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: owner.color }} />
                <span className="min-w-0 truncate">{owner.email}</span>
                <span className="shrink-0 text-zinc-400">· {PROVIDER_NAMES[owner.provider]}</span>
              </span>
            )}
          </div>

          <div className="space-y-3">
            {data.messages.map((message) => (
              <MessageCard
                key={message.id}
                accountId={data.accountId}
                accountEmail={owner?.email}
                threadId={data.id}
                onArchive={removalActions ? undefined : () => list.actOnOpenThread("archive")}
                message={message}
                expanded={expanded.has(message.id)}
                instant={instant}
                onToggle={() => {
                  setInstant(false);
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(message.id)) next.delete(message.id);
                    else next.add(message.id);
                    return next;
                  });
                }}
                onReply={(mode) => startReply(mode, message)}
              />
            ))}
          </div>

          <div id="reply-composer" className="mt-6">
            {draft ? (
              <div className="overflow-hidden rounded-xl border border-zinc-200 shadow-sm dark:border-zinc-800">
                <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                  {draft.reply?.kind === "forward" ? <ArrowBendUpRight className="size-3.5" /> : <ArrowBendUpLeft className="size-3.5" />}
                  {draft.reply?.kind === "forward" ? "Forward" : "Reply"} from {owner?.email}
                </div>
                <Composer
                  key={draft.id}
                  draft={draft}
                  onChange={saveDraft}
                  onDiscard={() => saveDraft(null)}
                  onSent={() => saveDraft(null)}
                  variant="inline"
                  autoFocus={draft.reply?.kind === "forward" ? "to" : "body"}
                />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <ReplyButton onClick={() => startReply("reply")} shortcut="R">
                  <ArrowBendUpLeft className="size-4" /> Reply
                </ReplyButton>
                <ReplyButton onClick={() => startReply("replyAll")} shortcut="A">
                  <ArrowBendDoubleUpLeft className="size-4" /> Reply all
                </ReplyButton>
                <ReplyButton onClick={() => startReply("forward")} shortcut="F">
                  <ArrowBendUpRight className="size-4" /> Forward
                </ReplyButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ReplyButton({
  onClick,
  shortcut,
  children,
}: {
  onClick(): void;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 press hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
    >
      {children}
      <kbd>{shortcut}</kbd>
    </button>
  );
}

function MessageCard({
  accountId,
  accountEmail,
  threadId,
  message,
  expanded,
  instant,
  onToggle,
  onReply,
  onArchive,
}: {
  accountId: string;
  accountEmail?: string;
  threadId: string;
  message: RenderedMessage;
  expanded: boolean;
  /** Open or close with no animation. */
  instant: boolean;
  onToggle(): void;
  onReply(mode: ReplyMode): void;
  onArchive?(): void;
}) {
  const [showQuotes, setShowQuotes] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [unsubscribeOpen, setUnsubscribeOpen] = useState(false);
  const [left, setLeft] = useState(() => isUnsubscribed(accountId, message.from));
  const canUnsubscribe = !!message.unsubscribe && !left;
  const recipients = [...message.to, ...message.cc];

  const menu = () => [
    { label: "Reply", icon: ArrowBendUpLeft, onSelect: () => onReply("reply") },
    { label: "Reply all", icon: ArrowBendDoubleUpLeft, onSelect: () => onReply("replyAll") },
    { label: "Forward", icon: ArrowBendUpRight, onSelect: () => onReply("forward") },
    "separator" as const,
    { label: expanded ? "Collapse" : "Expand", icon: ArrowsInLineVertical, onSelect: onToggle },
    expanded && {
      label: showDetails ? "Hide details" : "Show details",
      icon: Info,
      onSelect: () => setShowDetails((value) => !value),
    },
    "separator" as const,
    canUnsubscribe && { label: "Unsubscribe", icon: BellSlash, onSelect: () => setUnsubscribeOpen(true) },
    { label: "Copy sender address", icon: Copy, onSelect: () => copyText(message.from.email, "the address") },
    !message.html && {
      label: "Copy message text",
      icon: Copy,
      onSelect: () => copyText(message.text ?? message.snippet, "the message text"),
    },
  ];

  const text = message.html ? null : splitQuoted(message.text ?? message.snippet);

  // One card for both states. The header keeps its size, so only the body
  // moves when the message opens or closes.
  return (
    <Collapsible.Root
      open={expanded}
      render={<section className="rounded-xl border border-zinc-200 dark:border-zinc-800" />}
    >
      <ContextMenu items={menu}>
        <div
          onClick={onToggle}
          className={cx(
            "flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3 transition-colors",
            !expanded && "hover:bg-zinc-50 dark:hover:bg-zinc-900",
          )}
        >
          <Avatar name={message.from.name} email={message.from.email} />
          <div className="min-w-0 flex-1">
            {/* The click goes up to the header, which opens or closes the message. */}
            <div className="flex items-baseline gap-2">
              <button type="button" aria-expanded={expanded} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
                <span dir="auto" className={cx("max-w-[60%] shrink-0 truncate text-sm", expanded ? "font-semibold" : "font-medium")}>
                  {displayName(message.from)}
                </span>
                {expanded && <span className="truncate text-xs text-zinc-500">{message.from.email}</span>}
              </button>
              {expanded && canUnsubscribe && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setUnsubscribeOpen(true);
                  }}
                  className="shrink-0 text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:decoration-zinc-600 dark:hover:text-zinc-100"
                >
                  Unsubscribe
                </button>
              )}
            </div>
            {expanded ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowDetails((value) => !value);
                }}
                className="flex max-w-full items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <span className="truncate">to {recipients.map(displayName).join(", ") || "undisclosed recipients"}</span>
                <CaretDown className={cx("size-3 shrink-0 transition-[rotate] duration-200 ease-out", showDetails && "rotate-180")} />
              </button>
            ) : (
              <p className="truncate text-xs text-zinc-500">{message.snippet}</p>
            )}
          </div>
          <LocalDate iso={message.date} format={formatFullDate} className="shrink-0 pt-0.5 text-xs text-zinc-400" />
          {/* The buttons keep their space when the message closes, so the date does not move. */}
          <div
            onClick={(event) => event.stopPropagation()}
            inert={!expanded}
            className={cx(
              "-mt-1 -mr-2 flex shrink-0 transition-opacity duration-200 ease-out",
              !expanded && "opacity-0",
            )}
          >
            <IconButton label="Reply" onClick={() => onReply("reply")}>
              <ArrowBendUpLeft className="size-4" />
            </IconButton>
            <IconButton label="Forward" onClick={() => onReply("forward")}>
              <ArrowBendUpRight className="size-4" />
            </IconButton>
          </div>
        </div>
      </ContextMenu>

      {message.unsubscribe && (
        <UnsubscribeDialog
          open={unsubscribeOpen}
          onOpenChange={setUnsubscribeOpen}
          accountId={accountId}
          accountEmail={accountEmail}
          threadId={threadId}
          messageId={message.id}
          from={message.from}
          unsubscribe={message.unsubscribe}
          onDone={() => setLeft(true)}
          onArchive={onArchive}
        />
      )}

      {/* Height and opacity, 200 ms. Base UI measures the body height. With
          reduced motion, the body only fades. */}
      <Collapsible.Panel
        className={cx(
          "h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-opacity",
          instant && "duration-0",
        )}
      >
        {showDetails && (
          <dl className="mx-4 mb-3 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
            <DetailRow label="From" value={formatAddress(message.from)} />
            {message.to.length > 0 && <DetailRow label="To" value={message.to.map(formatAddress).join(", ")} />}
            {message.cc.length > 0 && <DetailRow label="Cc" value={message.cc.map(formatAddress).join(", ")} />}
            {message.bcc.length > 0 && <DetailRow label="Bcc" value={message.bcc.map(formatAddress).join(", ")} />}
            {message.replyTo.length > 0 && (
              <DetailRow label="Reply to" value={message.replyTo.map(formatAddress).join(", ")} />
            )}
            <DetailRow label="Date" value={formatFullDate(message.date)} />
          </dl>
        )}

        <div className="px-4 pb-4">
          {message.html ? (
            <EmailFrame html={message.html} showQuotes={showQuotes} title={message.subject} />
          ) : (
            <div dir="auto" className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              <Linkified text={text!.body} />
              {showQuotes && text!.quoted && (
                <div className="mt-3 border-l-2 border-zinc-200 pl-3 text-zinc-500 dark:border-zinc-700">
                  <Linkified text={text!.quoted} />
                </div>
              )}
            </div>
          )}

          {(message.hasQuote || text?.quoted) && (
            <Hint label={showQuotes ? "Hide quoted text" : "Show quoted text"}>
              <button
                type="button"
                aria-label={showQuotes ? "Hide quoted text" : "Show quoted text"}
                aria-expanded={showQuotes}
                onClick={() => setShowQuotes((value) => !value)}
                className="press mt-2 rounded-md bg-zinc-100 px-2 py-0.5 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                <DotsThree className="size-4" />
              </button>
            </Hint>
          )}

          {message.attachments.length > 0 && (
            <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
              {message.attachments.map((attachment) => {
                const preview = attachmentUrl(accountId, message.id, attachment.id);
                const download = attachmentUrl(accountId, message.id, attachment.id, true);
                const isImage = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(attachment.mimeType);
                return (
                  <li key={attachment.id}>
                    <a
                      href={isImage || attachment.mimeType === "application/pdf" ? preview : download}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex flex-col overflow-hidden rounded-lg border border-zinc-200 transition-[border-color,box-shadow] hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:hover:border-zinc-700"
                    >
                      {isImage && (
                        <img src={preview} alt="" loading="lazy" className="h-28 w-full bg-zinc-50 object-cover dark:bg-zinc-900" />
                      )}
                      <span className="flex items-center gap-2 px-3 py-2">
                        <FileText className="size-4 shrink-0 text-zinc-400" />
                        <span className="min-w-0 flex-1">
                          <FileName name={attachment.filename} className="text-xs font-medium" />
                          <span className="block text-[11px] text-zinc-400">{formatSize(attachment.size)}</span>
                        </span>
                        <DownloadSimple
                          className="size-3.5 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={(event) => {
                            event.preventDefault();
                            window.location.href = download;
                          }}
                        />
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="break-words text-zinc-700 dark:text-zinc-300">{value}</dd>
    </>
  );
}

/** Splits a plain-text message into the new text and the quoted reply chain. */
function splitQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(line.trim()) ||
      (line.startsWith(">") && lines.slice(i).every((l) => l.startsWith(">") || !l.trim())),
  );
  if (start <= 0) return { body: text.trimEnd(), quoted: "" };
  return { body: lines.slice(0, start).join("\n").trimEnd(), quoted: lines.slice(start).join("\n") };
}

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const list = useOutletContext<ListOutletContext | undefined>();
  const message = isRouteErrorResponse(error)
    ? String(error.data)
    : "Something went wrong while the conversation loaded.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="max-w-sm text-sm text-zinc-500">{message}</p>
      {list && (
        <button type="button" onClick={list.closeThread} className="text-sm font-medium text-accent-600 hover:underline">
          Back to the list
        </button>
      )}
    </div>
  );
}
