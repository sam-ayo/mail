import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CaretDown,
  MarkdownLogo,
  PaperPlaneTilt,
  PencilSimple,
  Paperclip,
  Trash,
  X,
} from "./icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ComposeDraft } from "~/lib/compose";
import { parseAddressList, textOn } from "~/lib/mail";
import { markdownToHtml } from "~/lib/markdown";
import { useConfirm } from "./confirm-dialog";
import { useMail } from "./mail-context";
import { useMediaQuery, useSheet } from "./touch";
import { ResizeHandle } from "./resize-handle";
import { Button, FileName, Hint, IconButton, cx } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Puts Markdown marks around the selected text in a field. With no selection, the
 * cursor goes between the marks. The edit goes through the browser, so undo works.
 */
function wrapSelection(field: HTMLTextAreaElement, before: string, after = before, empty = "") {
  const { selectionStart: start, selectionEnd: end, value } = field;
  const selected = value.slice(start, end) || empty;
  field.focus();
  const text = `${before}${selected}${after}`;
  if (!document.execCommand("insertText", false, text)) {
    field.setRangeText(text, start, end, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.setSelectionRange(start + before.length, start + before.length + selected.length);
}

const FORMATS: Record<string, [string, string?, string?]> = {
  b: ["**"],
  i: ["_"],
  e: ["`"],
  k: ["[", "](https://)", "link text"],
};

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface ComposerProps {
  draft: ComposeDraft;
  onChange(draft: ComposeDraft): void;
  onDiscard(): void;
  /** Called after the message goes into the undo-send queue. */
  onSent?(): void;
  variant: "window" | "inline";
  autoFocus?: "to" | "body";
  /** The body field fills the free height of the parent. The parent must have a fixed height. */
  fill?: boolean;
}

export function Composer({
  draft,
  onChange,
  onDiscard,
  onSent,
  variant,
  autoFocus = "to",
  fill = false,
}: ComposerProps) {
  const { accounts, send } = useMail();
  const confirm = useConfirm();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCopies, setShowCopies] = useState(!!(draft.cc || draft.bcc));
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const ccRef = useRef<HTMLInputElement>(null);
  const bccRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<ComposeDraft>) => onChange({ ...draft, ...patch });
  const activeAccounts = accounts.filter((a) => a.status === "active");

  useEffect(() => {
    if (autoFocus === "body" || (draft.to && autoFocus === "to")) bodyRef.current?.focus();
    else toRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grow the body field with its content. A field that fills its parent scrolls instead.
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    if (fill) {
      element.style.height = "";
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, variant === "inline" ? 120 : 340)}px`;
  }, [draft.body, variant, fill, preview]);

  function togglePreview() {
    flushSync(() => setPreview((value) => !value));
    // Keep the focus in the form, so ⌘↵ and ⌘⇧P still work. Safari does not focus a clicked button.
    (preview ? bodyRef : previewRef).current?.focus();
  }

  async function submit() {
    const recipients = [draft.to, draft.cc, draft.bcc].flatMap(parseAddressList);
    if (recipients.length === 0) return setError("Add at least one recipient.");
    const invalid = recipients.find((r) => !EMAIL.test(r.email));
    if (invalid) return setError(`“${invalid.email}” is not a valid email address.`);
    if (!draft.subject.trim() && !draft.body.trim()) {
      return setError("Add a subject or a message.");
    }
    if (
      files.length === 0 &&
      /\b(attached|attachment|enclosed)\b/i.test(draft.body) &&
      !(await confirm({
        title: "Send without an attachment?",
        description: "You wrote about an attachment, but no file is attached.",
        confirmLabel: "Send anyway",
      }))
    ) {
      return;
    }
    setError(null);
    send(draft, files);
    setFiles([]);
    onSent?.();
  }

  function addFiles(list: FileList | null) {
    if (list?.length) setFiles((current) => [...current, ...Array.from(list)]);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key === "Enter") {
          event.preventDefault();
          submit();
        }
        // ⌘⇧C and ⌘⇧B show the copy fields and move to Cc or Bcc.
        const key = event.key.toLowerCase();
        if (mod && event.shiftKey && key === "p") {
          event.preventDefault();
          togglePreview();
          return;
        }
        // ⌘B, ⌘I, ⌘E, and ⌘K add Markdown for bold, italic, code, and a link.
        const format = mod && !event.shiftKey && !event.altKey ? FORMATS[key] : undefined;
        if (format && event.target === bodyRef.current) {
          event.preventDefault();
          wrapSelection(bodyRef.current, ...format);
          return;
        }
        const copyField = mod && event.shiftKey ? (key === "c" ? ccRef : key === "b" ? bccRef : null) : null;
        if (copyField) {
          event.preventDefault();
          flushSync(() => setShowCopies(true));
          copyField.current?.focus();
          return;
        }
        // Return in a header field moves to the next field. It does not send.
        const target = event.target as HTMLElement;
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && target.tagName === "INPUT") {
          event.preventDefault();
          const fields = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>("input:not([type=file]), textarea"),
          );
          fields[fields.indexOf(target) + 1]?.focus();
          return;
        }
        if (event.key === "Escape" && variant === "inline") {
          event.preventDefault();
          (event.target as HTMLElement).blur();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
      className={cx("relative flex flex-col", fill && "min-h-full", dragging && "ring-2 ring-accent-500 ring-inset")}
    >
      <div className="divide-y divide-zinc-100 px-4 text-sm dark:divide-zinc-800">
        {variant === "window" && activeAccounts.length > 1 && (
          <Row label="From">
            <select
              value={draft.accountId}
              onChange={(event) => set({ accountId: event.target.value })}
              className="w-full bg-transparent py-2 outline-none"
            >
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name ? `${account.name} <${account.email}>` : account.email}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="To">
          <input
            ref={toRef}
            value={draft.to}
            onChange={(event) => set({ to: event.target.value })}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            className="w-full bg-transparent py-2 outline-none"
            placeholder="name@example.com"
            autoComplete="off"
          />
          {!showCopies && (
            <button
              type="button"
              onClick={() => setShowCopies(true)}
              className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Cc Bcc
            </button>
          )}
        </Row>
        {showCopies && (
          <>
            <Row label="Cc">
              <input
                ref={ccRef}
                value={draft.cc}
                onChange={(event) => set({ cc: event.target.value })}
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                className="w-full bg-transparent py-2 outline-none"
              />
            </Row>
            <Row label="Bcc">
              <input
                ref={bccRef}
                value={draft.bcc}
                onChange={(event) => set({ bcc: event.target.value })}
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                className="w-full bg-transparent py-2 outline-none"
              />
            </Row>
          </>
        )}
        {(variant === "window" || draft.reply?.kind === "forward") && (
          <Row label="Subject">
            <input
              value={draft.subject}
              onChange={(event) => set({ subject: event.target.value })}
              className="w-full bg-transparent py-2 font-medium outline-none"
            />
          </Row>
        )}
      </div>

      {preview && (
        <div
          ref={previewRef}
          tabIndex={-1}
          className={cx(
            "px-4 py-3 text-sm leading-relaxed break-words outline-none",
            fill ? "min-h-24 flex-1 sm:min-h-48" : variant === "inline" ? "min-h-30" : "min-h-85",
          )}
          // The Markdown renderer escapes raw HTML and removes unsafe links.
          dangerouslySetInnerHTML={{
            __html: draft.body.trim()
              ? markdownToHtml(draft.body)
              : '<p style="color:#a1a1aa">Nothing to preview</p>',
          }}
        />
      )}
      <textarea
        ref={bodyRef}
        hidden={preview}
        value={draft.body}
        onChange={(event) => set({ body: event.target.value })}
        className={cx(
          "w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed outline-none",
          fill && "min-h-24 flex-1 sm:min-h-48",
        )}
        placeholder={draft.reply ? "Write your reply…" : "Write your message…"}
      />

      {draft.quoted && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => set({ quoted: undefined })}
            title="Remove the quoted message"
            className="press group inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            {draft.reply?.kind === "forward" ? "Forwarded message included" : "Quoted text included"}
            <X className="size-3 opacity-50 group-hover:opacity-100" />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-4 pb-3">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-700"
            >
              <Paperclip className="size-3 text-zinc-400" />
              <FileName name={file.name} className="max-w-48 font-medium" />
              <span className="text-zinc-400">{formatSize(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((list) => list.filter((_, i) => i !== index))}
                className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}

      {/* In a window with a fixed height, the actions stay at the bottom while the fields scroll.
          On a phone, the keyboard leaves little height, and the Send button must stay above it. */}
      <div
        className={cx(
          "flex items-center gap-1 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800",
          fill && "sticky bottom-0 bg-white dark:bg-zinc-900",
        )}
      >
        <IconButton label="Discard draft" onClick={onDiscard}>
          <Trash className="size-4" />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <IconButton label="Attach files" onClick={() => fileRef.current?.click()}>
          <Paperclip className="size-4" />
        </IconButton>
        <IconButton
          label={preview ? "Edit Markdown" : "Preview Markdown"}
          shortcut="⌘⇧P"
          aria-pressed={preview}
          onClick={togglePreview}
          className={cx(preview && "text-zinc-900 dark:text-zinc-100")}
        >
          {preview ? <PencilSimple className="size-4" /> : <MarkdownLogo className="size-4" />}
        </IconButton>
        <div className="flex-1" />
        <Button type="submit" variant="primary" className="h-8">
          <PaperPlaneTilt className="size-3.5" /> Send
          <kbd className="ml-1 border-white/25 bg-white/15 text-white">⌘↵</kbd>
        </Button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

const EXPANDED_STORAGE_KEY = "relay:compose-expanded";
const SIZE_STORAGE_KEY = "relay:compose-size";
const MIN_WIDTH = 420;
const MIN_HEIGHT = 240;
/** A pointer must move this far before a press on the title bar becomes a drag. */
const DRAG_THRESHOLD = 4;

/** A null value is the default size. The default height follows the content. */
interface WindowSize {
  width: number | null;
  height: number | null;
}

function readSize(): WindowSize {
  try {
    const value = JSON.parse(localStorage.getItem(SIZE_STORAGE_KEY) ?? "null");
    return {
      width: typeof value?.width === "number" ? value.width : null,
      height: typeof value?.height === "number" ? value.height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

/** The floating window for a new message or a forward. */
export function ComposeWindow() {
  const { compose, updateCompose, closeCompose, account } = useMail();
  const [minimizedState, setMinimized] = useState(false);
  const [expandedState, setExpandedState] = useState(false);
  // On a phone the window is a sheet over the full screen, as in iOS Mail. It
  // does not move, change size, or minimize.
  const sheet = useMediaQuery("(max-width: 39.99rem)");
  const minimized = minimizedState && !sheet;
  const expanded = expandedState || sheet;

  // A sheet slides down after the draft closes, so it keeps the last draft
  // until the slide ends. A window closes at once.
  const [shown, setShown] = useState(compose);
  if (compose && compose !== shown) setShown(compose);
  if (!compose && shown && !sheet) setShown(null);
  const draft = compose ?? shown;
  const closing = !compose && !!shown;
  const sheetMotion = useSheet({
    enabled: sheet && !!draft,
    open: !!compose,
    onDismiss: closeCompose,
    onClosed: () => setShown(null),
  });

  useEffect(() => setMinimized(false), [compose?.id]);

  // Keep the size that the person chose last.
  const [size, setSizeState] = useState<WindowSize>({ width: null, height: null });
  const windowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setExpandedState(localStorage.getItem(EXPANDED_STORAGE_KEY) === "1");
    setSizeState(readSize());
  }, []);
  function setExpanded(next: boolean) {
    setExpandedState(next);
    localStorage.setItem(EXPANDED_STORAGE_KEY, next ? "1" : "0");
  }
  function setSize(next: Partial<WindowSize>, save: boolean) {
    // During a drag, change only the element. A React render on each pointer
    // move drops frames. The state changes once, at the end of the drag.
    // The first set height changes the layout of the body field, so React
    // renders that one move.
    const element = windowRef.current;
    if (!save && element && (next.height == null || size.height !== null)) {
      if (next.width != null) element.style.width = `${next.width}px`;
      if (next.height != null) element.style.height = `${next.height}px`;
      return;
    }
    setSizeState((current) => {
      const value = { ...current, ...next };
      if (save) localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  }
  // The distance from the default place at the bottom right, in px.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const move = useRef<{ x: number; y: number; offset: { x: number; y: number }; rect: DOMRect; moved: boolean } | null>(
    null,
  );
  const movable = !expanded && !sheet;

  // The iOS keyboard covers the page and does not make it smaller. It can
  // also scroll the page. Thus the sheet follows the part of the screen that
  // shows, so the header and the send button stay above the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = windowRef.current;
    if (!sheet || !viewport || !element) return;
    const fit = () => {
      const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      element.style.top = `calc(${viewport.offsetTop}px + env(safe-area-inset-top) + 0.75rem)`;
      element.style.bottom = `${keyboard}px`;
      // The home indicator is under the keyboard.
      element.style.paddingBottom = keyboard ? "0px" : "";
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      element.style.top = element.style.bottom = element.style.paddingBottom = "";
    };
  }, [sheet, draft?.id]);

  // Keep the full window in the viewport when its size or the viewport size changes.
  useLayoutEffect(() => {
    if (!movable) return;
    function fit() {
      const rect = windowRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = Math.max(0, -rect.left) - Math.max(0, rect.right - window.innerWidth);
      const dy = Math.max(0, -rect.top) - Math.max(0, rect.bottom - window.innerHeight);
      if (dx || dy) setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [movable, minimized, size, offset, compose?.id]);

  function endMove() {
    if (!move.current) return;
    document.documentElement.style.userSelect = "";
    // Keep the record of a drag until the click event, so the click does not minimize the window.
    if (!move.current.moved) move.current = null;
  }

  const resizable = !expanded && !minimized;
  // A window with a set height has a fixed height, so the body field can fill it.
  const fill = expanded || (resizable && size.height !== null);

  if (!draft) return null;
  const title = draft.subject || "New message";
  const sender = account(draft.accountId);

  return (
    <>
      {sheet && <div ref={sheetMotion.backdrop} aria-hidden className="fixed inset-0 z-40 bg-zinc-950/40" />}
      <div
        className={cx(
          "fixed z-40 flex flex-col overflow-hidden rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-zinc-900/20 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10",
          sheet
            ? "inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] bottom-0 rounded-t-2xl"
            : expanded
              ? "inset-x-2 top-4 bottom-0 sm:inset-x-[4%] sm:top-[4%] sm:bottom-[4%] sm:rounded-b-xl"
              : "right-2 bottom-0 w-[min(720px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] sm:right-6",
        )}
        style={
          expanded
            ? undefined
            : {
                width: size.width ?? undefined,
                height: !minimized && size.height !== null ? size.height : undefined,
                translate: `${offset.x}px ${offset.y}px`,
              }
        }
        ref={(element) => {
          windowRef.current = element;
          sheetMotion.sheet.current = element;
        }}
        role="dialog"
        aria-label={title}
        inert={closing}
      >
        {resizable && (
          <>
            <ResizeHandle
              edge="left"
              label="Resize window width"
              min={MIN_WIDTH}
              max={() => window.innerWidth - 32}
              className="hidden sm:block"
              size={() => windowRef.current?.getBoundingClientRect().width ?? MIN_WIDTH}
              onResize={(width, done) => setSize({ width }, done)}
              onReset={() => setSize({ width: null }, true)}
            />
            <ResizeHandle
              edge="top"
              label="Resize window height"
              min={MIN_HEIGHT}
              max={() => window.innerHeight - 16}
              className="hidden sm:block"
              size={() => windowRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT}
              onResize={(height, done) => setSize({ height }, done)}
              onReset={() => setSize({ height: null }, true)}
            />
          </>
        )}
        <header
          ref={sheetMotion.handle}
          className={cx(
            "flex items-center gap-2 px-4 py-2 text-sm max-sm:py-3",
            !sender && "bg-zinc-900 text-white dark:bg-zinc-800",
            movable ? "cursor-grab touch-none active:cursor-grabbing" : !sheet && "cursor-pointer",
          )}
          // The account color shows which address sends the message.
          style={sender ? { background: sender.color, color: textOn(sender.color) } : undefined}
          onClick={() => {
            const dragged = move.current?.moved;
            move.current = null;
            if (!dragged && !sheet) setMinimized((value) => !value);
          }}
          onPointerDown={(event) => {
            move.current = null;
            if (!movable || event.button !== 0 || !windowRef.current) return;
            if ((event.target as HTMLElement).closest("button")) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            move.current = {
              x: event.clientX,
              y: event.clientY,
              offset,
              rect: windowRef.current.getBoundingClientRect(),
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const start = move.current;
            if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            let dx = event.clientX - start.x;
            let dy = event.clientY - start.y;
            if (!start.moved) {
              if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
              start.moved = true;
              // Stop text selection while the pointer is over the page.
              document.documentElement.style.userSelect = "none";
            }
            // Keep the full window in the viewport.
            dx = Math.min(window.innerWidth - start.rect.right, Math.max(-start.rect.left, dx));
            dy = Math.min(window.innerHeight - start.rect.bottom, Math.max(-start.rect.top, dy));
            setOffset({ x: Math.round(start.offset.x + dx), y: Math.round(start.offset.y + dy) });
          }}
          onPointerUp={endMove}
          onLostPointerCapture={endMove}
          onDoubleClick={() => movable && setOffset({ x: 0, y: 0 })}
        >
          <span className="truncate font-medium">{title}</span>
          {sender && (
            <span title={`From ${sender.email}`} className="min-w-0 truncate text-xs opacity-75">
              {sender.email}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            aria-label={minimized ? "Open" : "Minimize"}
            className="opacity-70 hover:opacity-100 max-sm:hidden"
          >
            <CaretDown className={cx("size-4 transition-[rotate] duration-200 ease-out", minimized && "rotate-180")} />
          </button>
          <Hint label={expanded ? "Smaller window" : "Larger window"} shortcut="⌘⇧E">
            <button
              type="button"
              aria-label={expanded ? "Smaller window" : "Larger window"}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(!expanded);
                setMinimized(false);
              }}
              className="opacity-70 hover:opacity-100 max-sm:hidden"
            >
              {expanded ? <ArrowsInSimple className="size-3.5" /> : <ArrowsOutSimple className="size-3.5" />}
            </button>
          </Hint>
          <button
            type="button"
            aria-label="Close"
            onClick={(event) => {
              event.stopPropagation();
              closeCompose();
            }}
            className="opacity-70 hover:opacity-100 max-sm:-my-2 max-sm:-mr-2 max-sm:grid max-sm:size-10 max-sm:place-items-center"
          >
            <X className="size-4 max-sm:size-5" />
          </button>
        </header>
        {!minimized && (
          <div
            className={cx("overflow-y-auto", fill ? "min-h-0 flex-1" : "max-h-[80vh]")}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "e") {
                event.preventDefault();
                setExpanded(!expanded);
              }
            }}
          >
            <Composer
              key={draft.id}
              draft={draft}
              onChange={updateCompose}
              onDiscard={closeCompose}
              variant="window"
              fill={fill}
            />
          </div>
        )}
      </div>
    </>
  );
}
