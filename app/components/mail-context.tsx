import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRevalidator } from "react-router";
import type { ComposeDraft } from "~/lib/compose";
import { buildOutgoing, newDraftId, savesDrafts } from "~/lib/compose";
import type { AccountSummary, Folder, ThreadAction } from "~/lib/mail";
import { removesFromFolder, threadKey } from "~/lib/mail";
import { toast } from "sonner";

export interface ThreadRef {
  accountId: string;
  threadId: string;
}

/** A local change that shows before the server confirms it. */
export interface ThreadPatch {
  unread?: boolean;
  starred?: boolean;
  removed?: boolean;
  /** Time of the change. Data that loads after this time replaces the patch. */
  at: number;
}

interface PendingSend {
  draft: ComposeDraft;
  files: File[];
  timer: ReturnType<typeof setTimeout>;
}

/** A draft on the mail server. */
interface RemoteDraft {
  accountId: string;
  draftId: string;
}

export type DraftStatus = "saving" | "saved" | "error";

/** The state of the save of one composer to the mail server. */
interface DraftSync {
  /** The content at the last save, or when the composer opened. */
  saved: string;
  latest: ComposeDraft;
  remote?: RemoteDraft;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
  /** The content changed during a save. */
  again?: boolean;
  /** The message is in the send queue, or the person discarded it. No save starts. */
  closed?: boolean;
}

/** The pause in the typing after which a draft saves. */
const DRAFT_SAVE_MS = 1500;
/** The server draft of each composer, so a reload does not make a second draft. */
const DRAFT_IDS_STORAGE_KEY = "relay:draft-ids";

function readDraftIds(): Record<string, RemoteDraft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_IDS_STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writeDraftId(composeId: string, remote: RemoteDraft | undefined) {
  const ids = readDraftIds();
  if (remote) ids[composeId] = remote;
  else delete ids[composeId];
  localStorage.setItem(DRAFT_IDS_STORAGE_KEY, JSON.stringify(ids));
}

/** The content of a draft that a save writes. */
function draftContent(draft: ComposeDraft) {
  return JSON.stringify([draft.accountId, draft.to, draft.cc, draft.bcc, draft.subject, draft.body, !!draft.quoted]);
}

async function draftRequest(method: "POST" | "DELETE", body: object) {
  const response = await fetch("/api/drafts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { draftId?: string; error?: string };
  if (!response.ok) throw new Error(result.error ?? "The draft did not save");
  return result;
}

interface MailContextValue {
  accounts: AccountSummary[];
  account(id: string): AccountSummary | undefined;
  patches: Record<string, ThreadPatch>;
  runAction(
    targets: ThreadRef[],
    action: ThreadAction,
    /**
     * `count` is the number of conversations for the toast, if it differs from `targets`.
     * `counted` tells that the targets are in the unread counts. Then a read or
     * an unread action changes the counts at once, before the server answers.
     */
    options?: { folder?: Folder; quiet?: boolean; count?: number; counted?: boolean },
  ): Promise<void>;
  compose: ComposeDraft | null;
  openCompose(draft?: Partial<ComposeDraft>): void;
  updateCompose(draft: ComposeDraft): void;
  /** Closes the compose window. The draft stays on the mail server. */
  closeCompose(): void;
  /** Closes the compose window and deletes its draft. */
  discardCompose(): void;
  send(draft: ComposeDraft, files: File[]): void;
  /** Saves the draft on the mail server after a pause. A composer calls this on each change. */
  syncDraft(draft: ComposeDraft): void;
  /** Deletes the draft from the mail server. */
  discardDraft(draft: ComposeDraft): Promise<void>;
  /** The save state of each composer that has a draft on the mail server. */
  draftStatus: Record<string, DraftStatus>;
  /** The current ID of the server draft of a composer. */
  serverDraftId(composeId: string): string | undefined;
  unreadCounts: Record<string, number | null>;
  refreshCounts(): void;
  defaultAccountId: string | undefined;
  /** Number of thread actions that wait for the server. */
  pendingActions: number;
  /** Reverses the most recent action that showed an Undo button. */
  undoLast(): void;
}

const MailContext = createContext<MailContextValue | null>(null);

export function useMail() {
  const value = useContext(MailContext);
  if (!value) throw new Error("useMail needs a MailProvider");
  return value;
}

/**
 * A reply that the list asks for before the conversation opens. The thread
 * view reads it when the conversation with this key shows.
 */
export const replyRequest: { current: { key: string; mode: "reply" | "replyAll" | "forward" } | null } = {
  current: null,
};

export const UNDO_SEND_SECONDS = 5;
const COMPOSE_STORAGE_KEY = "relay:compose";

const ACTION_LABELS: Partial<Record<ThreadAction, string>> = {
  archive: "Archived",
  trash: "Moved to Trash",
  spam: "Marked as spam",
  inbox: "Moved to Inbox",
  star: "Starred",
  unstar: "Star removed",
  unread: "Marked as unread",
};

function inverse(action: ThreadAction, folder?: Folder): ThreadAction | undefined {
  switch (action) {
    case "archive":
    case "trash":
    case "spam":
      return folder === "archive" ? "archive" : "inbox";
    case "inbox":
      return "archive";
    case "star":
      return "unstar";
    case "unstar":
      return "star";
    case "unread":
      return "read";
    default:
      return undefined;
  }
}

function patchFor(action: ThreadAction, folder: Folder | undefined): Omit<ThreadPatch, "at"> {
  const patch: Omit<ThreadPatch, "at"> = {};
  if (action === "read") patch.unread = false;
  if (action === "unread") patch.unread = true;
  if (action === "star") patch.starred = true;
  if (action === "unstar") patch.starred = false;
  if (folder) patch.removed = removesFromFolder(action, folder);
  if (action === "archive" || action === "trash" || action === "spam") patch.unread = false;
  return patch;
}

export function MailProvider({
  accounts,
  children,
}: {
  accounts: AccountSummary[];
  children: React.ReactNode;
}) {
  const revalidator = useRevalidator();
  const [patches, setPatches] = useState<Record<string, ThreadPatch>>({});
  const [pendingActions, setPendingActions] = useState(0);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number | null>>({});
  const sends = useRef(new Map<string, PendingSend>());
  const lastUndo = useRef<(() => void) | null>(null);

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  // A new message comes from the account that is open in the sidebar.
  const { scope, folder } = useParams();
  const defaultAccountId =
    (scope && accountMap.has(scope) ? scope : undefined) ??
    accounts.find((a) => a.status === "active")?.id ??
    accounts[0]?.id;
  const account = useCallback((id: string) => accountMap.get(id), [accountMap]);

  // A local change to the counts makes the server counts from an older
  // request out of date. Each local change increments this version.
  const countsVersion = useRef(0);
  const refreshCounts = useCallback(() => {
    const version = countsVersion.current;
    fetch("/api/counts")
      .then((response) =>
        response.ok ? (response.json() as Promise<Record<string, number | null>>) : null,
      )
      .then((counts) => counts && version === countsVersion.current && setUnreadCounts(counts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts, accounts.length]);

  // Each check keeps a Vercel function instance alive, and the Hobby plan limits
  // that time. Web push tells you about new mail, so check only every 90 seconds
  // while the tab is visible. Also check when you come back to the tab, because a
  // hidden tab does not check.
  const idle = pendingActions === 0 && revalidator.state === "idle";
  const idleRef = useRef(idle);
  idleRef.current = idle;
  useEffect(() => {
    let lastCheck = Date.now();
    const check = (minAge: number) => {
      if (document.visibilityState !== "visible" || !idleRef.current) return;
      if (Date.now() - lastCheck < minAge) return;
      lastCheck = Date.now();
      revalidator.revalidate();
      refreshCounts();
    };
    const interval = setInterval(() => check(60_000), 90_000);
    const onReturn = () => check(5_000);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCounts]);

  const runAction = useCallback<MailContextValue["runAction"]>(
    async (targets, action, options = {}) => {
      if (targets.length === 0) return;
      const at = Date.now();
      const keys = targets.map((t) => threadKey(t.accountId, t.threadId));
      const patch = patchFor(action, options.folder);
      let previous: Record<string, ThreadPatch | undefined> = {};
      setPatches((current) => {
        previous = Object.fromEntries(keys.map((key) => [key, current[key]]));
        const next = { ...current };
        for (const key of keys) next[key] = { ...current[key], ...patch, at };
        return next;
      });
      if (options.counted && (action === "read" || action === "unread")) {
        countsVersion.current += 1;
        const delta = action === "read" ? -1 : 1;
        setUnreadCounts((current) => {
          const next = { ...current };
          for (const { accountId } of targets) {
            const count = next[accountId];
            if (typeof count === "number") next[accountId] = Math.max(0, count + delta);
          }
          return next;
        });
      }
      setPendingActions((n) => n + 1);

      try {
        const response = await fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets, action }),
        });
        const result = (await response.json()) as {
          results: { accountId: string; threadId: string; newThreadId: string }[];
          errors: { message: string }[];
        };
        if (!response.ok || result.errors.length) {
          throw new Error(result.errors[0]?.message ?? "The action failed");
        }
        refreshCounts();

        const undo = inverse(action, options.folder);
        const label = ACTION_LABELS[action];
        if (!options.quiet && label && undo) {
          const count = options.count ?? targets.length;
          const undoThis = async () => {
            if (lastUndo.current === undoThis) lastUndo.current = null;
                const restored = result.results.map((r) => ({
                  accountId: r.accountId,
                  threadId: r.newThreadId,
                }));
                setPatches((current) => {
                  const next = { ...current };
                  for (const key of keys) next[key] = { ...previous[key], removed: false, at: Date.now() };
                  return next;
                });
                await runAction(restored, undo, { quiet: true });
                // A move can change thread IDs (IMAP), so reload the list.
                if (restored.some((r, i) => r.threadId !== targets[i]?.threadId)) {
                  revalidator.revalidate();
                }
          };
          lastUndo.current = undoThis;
          toast(count > 1 ? `${label} · ${count} conversations` : label, {
            id: "thread-action",
            action: { label: "Undo", onClick: undoThis },
          });
        }
      } catch (error) {
        setPatches((current) => {
          const next = { ...current };
          for (const key of keys) {
            if (previous[key]) next[key] = previous[key]!;
            else delete next[key];
          }
          return next;
        });
        toast.error(error instanceof Error ? error.message : "The action failed");
        // The server counts replace the local change.
        if (options.counted) refreshCounts();
      } finally {
        setPendingActions((n) => n - 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshCounts],
  );

  const syncs = useRef(new Map<string, DraftSync>());
  const [draftStatus, setDraftStatus] = useState<Record<string, DraftStatus>>({});
  const setStatus = useCallback((composeId: string, status: DraftStatus | undefined) => {
    setDraftStatus((current) => {
      if (current[composeId] === status) return current;
      const next = { ...current };
      if (status) next[composeId] = status;
      else delete next[composeId];
      return next;
    });
  }, []);

  // The Drafts list shows the drafts of the mail server, so it reloads after a change.
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const draftsChanged = useCallback(() => {
    if (folderRef.current === "drafts") revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncOf = useCallback((draft: ComposeDraft) => {
    let sync = syncs.current.get(draft.id);
    if (!sync) {
      const remote =
        readDraftIds()[draft.id] ??
        (draft.draftId ? { accountId: draft.accountId, draftId: draft.draftId } : undefined);
      sync = { saved: draftContent(draft), latest: draft, remote };
      syncs.current.set(draft.id, sync);
    }
    return sync;
  }, []);

  const forgetDraft = useCallback(
    (composeId: string) => {
      clearTimeout(syncs.current.get(composeId)?.timer);
      syncs.current.delete(composeId);
      writeDraftId(composeId, undefined);
      setStatus(composeId, undefined);
    },
    [setStatus],
  );

  /** Saves the newest content. Only one save of a composer runs at a time, so it makes only one draft. */
  const saveDraftNow = useCallback(
    (composeId: string): Promise<void> => {
      const sync = syncs.current.get(composeId);
      if (!sync) return Promise.resolve();
      clearTimeout(sync.timer);
      sync.timer = undefined;
      if (sync.running) {
        sync.again = true;
        return sync.running;
      }
      sync.running = (async () => {
        do {
          sync.again = false;
          const draft = sync.latest;
          const content = draftContent(draft);
          const moved = sync.remote && sync.remote.accountId !== draft.accountId;
          if (sync.closed || (content === sync.saved && !moved)) break;
          setStatus(composeId, "saving");
          try {
            // The person changed the From address. The draft moves to the new account.
            if (moved) {
              await draftRequest("DELETE", sync.remote!).catch(() => {});
              sync.remote = undefined;
              writeDraftId(composeId, undefined);
            }
            if (!savesDrafts(accountMap.get(draft.accountId))) {
              sync.saved = content;
              setStatus(composeId, undefined);
              continue;
            }
            const { html, text } = buildOutgoing(draft);
            const result = await draftRequest("POST", {
              accountId: draft.accountId,
              draftId: sync.remote?.draftId,
              to: draft.to,
              cc: draft.cc,
              bcc: draft.bcc,
              subject: draft.subject,
              html,
              text,
              reply: draft.reply,
            });
            sync.remote = { accountId: draft.accountId, draftId: result.draftId! };
            sync.saved = content;
            // A composer that closed during the save has no entry to keep.
            if (syncs.current.get(composeId) === sync) {
              writeDraftId(composeId, sync.remote);
              setStatus(composeId, "saved");
            }
          } catch {
            // The next change starts a new save.
            if (syncs.current.get(composeId) === sync) setStatus(composeId, "error");
            break;
          }
        } while (sync.again);
      })().finally(() => {
        sync.running = undefined;
      });
      return sync.running;
    },
    [accountMap, setStatus],
  );

  const syncDraft = useCallback(
    (draft: ComposeDraft) => {
      const sync = syncOf(draft);
      sync.latest = draft;
      if (sync.closed) return;
      clearTimeout(sync.timer);
      const moved = sync.remote && sync.remote.accountId !== draft.accountId;
      if (draftContent(draft) === sync.saved && !moved) return;
      sync.timer = setTimeout(() => saveDraftNow(draft.id), DRAFT_SAVE_MS);
    },
    [saveDraftNow, syncOf],
  );

  const discardDraft = useCallback(
    async (draft: ComposeDraft) => {
      const sync = syncOf(draft);
      sync.closed = true;
      clearTimeout(sync.timer);
      forgetDraft(draft.id);
      await sync.running;
      if (!sync.remote) return;
      try {
        await draftRequest("DELETE", sync.remote);
        draftsChanged();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The draft is still on the mail server");
      }
    },
    [draftsChanged, forgetDraft, syncOf],
  );

  const serverDraftId = useCallback((composeId: string) => syncs.current.get(composeId)?.remote?.draftId, []);

  // A hidden tab can close with no more events. Save what waits.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState !== "hidden") return;
      for (const [composeId, sync] of syncs.current) if (sync.timer) saveDraftNow(composeId);
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [saveDraftNow]);

  const composeRef = useRef(compose);
  composeRef.current = compose;

  /**
   * Saves the last changes of a composer that closes. Then the draft is in the
   * Drafts folder, and the composer has no more state.
   */
  const releaseDraft = useCallback(
    (draft: ComposeDraft) => {
      const sync = syncs.current.get(draft.id);
      if (!sync || sync.closed) return;
      saveDraftNow(draft.id).then(() => {
        // The person opened the same composer again.
        if (composeRef.current?.id === draft.id) return;
        const failed = draftContent(sync.latest) !== sync.saved;
        forgetDraft(draft.id);
        if (failed) toast.error("The draft did not save");
        else if (sync.remote) {
          toast("Saved to Drafts", { id: "draft-saved" });
          draftsChanged();
        }
      });
    },
    [draftsChanged, forgetDraft, saveDraftNow],
  );

  // Keep the open compose window across reloads.
  useEffect(() => {
    const saved = localStorage.getItem(COMPOSE_STORAGE_KEY);
    if (saved) {
      try {
        setCompose(JSON.parse(saved));
      } catch {
        localStorage.removeItem(COMPOSE_STORAGE_KEY);
      }
    }
  }, []);

  const updateCompose = useCallback(
    (draft: ComposeDraft) => {
      // The window shows one message. A different message that was open goes to Drafts.
      const previous = composeRef.current;
      if (previous && previous.id !== draft.id) releaseDraft(previous);
      composeRef.current = draft;
      setCompose(draft);
      localStorage.setItem(COMPOSE_STORAGE_KEY, JSON.stringify(draft));
    },
    [releaseDraft],
  );

  const openCompose = useCallback(
    (draft: Partial<ComposeDraft> = {}) => {
      const accountId =
        draft.accountId && accountMap.has(draft.accountId) ? draft.accountId : defaultAccountId;
      if (!accountId) return;
      updateCompose({
        id: newDraftId(),
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        body: "",
        ...draft,
        accountId,
      });
    },
    [accountMap, defaultAccountId, updateCompose],
  );

  const closeCompose = useCallback(() => {
    const draft = composeRef.current;
    composeRef.current = null;
    setCompose(null);
    localStorage.removeItem(COMPOSE_STORAGE_KEY);
    if (draft) releaseDraft(draft);
  }, [releaseDraft]);

  const discardCompose = useCallback(() => {
    const draft = composeRef.current;
    composeRef.current = null;
    setCompose(null);
    localStorage.removeItem(COMPOSE_STORAGE_KEY);
    if (draft) discardDraft(draft);
  }, [discardDraft]);

  const deliver = useCallback(
    async (id: string) => {
      const pending = sends.current.get(id);
      if (!pending) return;
      sends.current.delete(id);
      const { draft, files } = pending;
      const sync = syncs.current.get(id);
      // A save that started before the send must end first, so the send can remove its draft.
      await sync?.running;
      const remote = sync?.remote;
      const { html, text } = buildOutgoing(draft);
      const form = new FormData();
      form.set("accountId", draft.accountId);
      form.set("to", draft.to);
      form.set("cc", draft.cc);
      form.set("bcc", draft.bcc);
      form.set("subject", draft.subject);
      form.set("html", html);
      form.set("text", text);
      if (draft.reply) form.set("reply", JSON.stringify(draft.reply));
      if (remote?.accountId === draft.accountId) form.set("draftId", remote.draftId);
      files.forEach((file) => form.append("attachments", file));

      toast.loading("Sending…", { id: `send-${id}`, action: undefined });
      try {
        const response = await fetch("/api/send", { method: "POST", body: form });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "The message did not send");
        toast.success("Message sent", { id: `send-${id}`, duration: 4000 });
        // The draft of a different account does not go with the send.
        if (remote && remote.accountId !== draft.accountId) draftRequest("DELETE", remote).catch(() => {});
        forgetDraft(id);
        revalidator.revalidate();
      } catch (error) {
        if (sync) sync.closed = false;
        toast.error(error instanceof Error ? error.message : "The message did not send", {
          id: `send-${id}`,
          duration: Infinity,
          action: { label: "Edit", onClick: () => updateCompose(draft) },
        });
      }
    },
    [forgetDraft, revalidator, updateCompose],
  );

  const send = useCallback(
    (draft: ComposeDraft, files: File[]) => {
      const timer = setTimeout(() => deliver(draft.id), UNDO_SEND_SECONDS * 1000);
      sends.current.set(draft.id, { draft, files, timer });
      // The send has the full message, so no more saves are necessary.
      const sync = syncs.current.get(draft.id);
      if (sync) {
        clearTimeout(sync.timer);
        sync.timer = undefined;
        sync.closed = true;
      }
      setCompose((current) => {
        if (current?.id === draft.id) {
          localStorage.removeItem(COMPOSE_STORAGE_KEY);
          return null;
        }
        return current;
      });
      toast("Sending…", {
        id: `send-${draft.id}`,
        duration: UNDO_SEND_SECONDS * 1000,
        action: {
          label: "Undo",
          onClick: () => {
            const pending = sends.current.get(draft.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            sends.current.delete(draft.id);
            if (sync) sync.closed = false;
            updateCompose(draft);
          },
        },
      });
    },
    [deliver, updateCompose],
  );

  // Warn before the tab closes while a message waits in the undo window.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (sends.current.size > 0) event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const undoLast = useCallback(() => {
    if (!lastUndo.current) return;
    toast.dismiss("thread-action");
    lastUndo.current();
  }, []);

  const value: MailContextValue = {
    accounts,
    account,
    patches,
    runAction,
    compose,
    openCompose,
    updateCompose,
    closeCompose,
    discardCompose,
    send,
    syncDraft,
    discardDraft,
    draftStatus,
    serverDraftId,
    unreadCounts,
    refreshCounts,
    defaultAccountId,
    pendingActions,
    undoLast,
  };

  return <MailContext.Provider value={value}>{children}</MailContext.Provider>;
}

/** Applies local patches that are newer than the data. */
export function applyPatch<T extends { unread: boolean; starred: boolean }>(
  item: T,
  patch: ThreadPatch | undefined,
  dataLoadedAt: number,
): T & { removed?: boolean } {
  if (!patch || patch.at < dataLoadedAt) return item;
  return {
    ...item,
    unread: patch.unread ?? item.unread,
    starred: patch.starred ?? item.starred,
    removed: patch.removed,
  };
}
