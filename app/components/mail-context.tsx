import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRevalidator } from "react-router";
import type { ComposeDraft } from "~/lib/compose";
import { buildOutgoing, newDraftId } from "~/lib/compose";
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

interface MailContextValue {
  accounts: AccountSummary[];
  account(id: string): AccountSummary | undefined;
  patches: Record<string, ThreadPatch>;
  runAction(
    targets: ThreadRef[],
    action: ThreadAction,
    /** `count` is the number of conversations for the toast, if it differs from `targets`. */
    options?: { folder?: Folder; quiet?: boolean; count?: number },
  ): Promise<void>;
  compose: ComposeDraft | null;
  openCompose(draft?: Partial<ComposeDraft>): void;
  updateCompose(draft: ComposeDraft): void;
  closeCompose(): void;
  send(draft: ComposeDraft, files: File[]): void;
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
  const { scope } = useParams();
  const defaultAccountId =
    (scope && accountMap.has(scope) ? scope : undefined) ??
    accounts.find((a) => a.status === "active")?.id ??
    accounts[0]?.id;
  const account = useCallback((id: string) => accountMap.get(id), [accountMap]);

  const refreshCounts = useCallback(() => {
    fetch("/api/counts")
      .then((response) =>
        response.ok ? (response.json() as Promise<Record<string, number | null>>) : null,
      )
      .then((counts) => counts && setUnreadCounts(counts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts, accounts.length]);

  // Check for new mail every minute while the tab is visible.
  const idle = pendingActions === 0 && revalidator.state === "idle";
  const idleRef = useRef(idle);
  idleRef.current = idle;
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible" || !idleRef.current) return;
      revalidator.revalidate();
      refreshCounts();
    }, 60_000);
    return () => clearInterval(interval);
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
      } finally {
        setPendingActions((n) => n - 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshCounts],
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

  const updateCompose = useCallback((draft: ComposeDraft) => {
    setCompose(draft);
    localStorage.setItem(COMPOSE_STORAGE_KEY, JSON.stringify(draft));
  }, []);

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
    setCompose(null);
    localStorage.removeItem(COMPOSE_STORAGE_KEY);
  }, []);

  const deliver = useCallback(
    async (id: string) => {
      const pending = sends.current.get(id);
      if (!pending) return;
      sends.current.delete(id);
      const { draft, files } = pending;
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
      files.forEach((file) => form.append("attachments", file));

      toast.loading("Sending…", { id: `send-${id}`, action: undefined });
      try {
        const response = await fetch("/api/send", { method: "POST", body: form });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "The message did not send");
        toast.success("Message sent", { id: `send-${id}`, duration: 4000 });
        revalidator.revalidate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The message did not send", {
          id: `send-${id}`,
          duration: Infinity,
          action: { label: "Edit", onClick: () => updateCompose(draft) },
        });
      }
    },
    [revalidator, updateCompose],
  );

  const send = useCallback(
    (draft: ComposeDraft, files: File[]) => {
      const timer = setTimeout(() => deliver(draft.id), UNDO_SEND_SECONDS * 1000);
      sends.current.set(draft.id, { draft, files, timer });
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
    send,
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
