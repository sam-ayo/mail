import { ThemeProvider, useCallTool, useToolContext, useViewState, useViewTheme } from "mcp-use/react";
import type { ViewConfig } from "mcp-use/react";
import { useEffect, useRef, useState } from "react";
import "./styles.css";

// The draft that compose_message returns. The user edits it here, and Send calls send_message.

export const viewConfig = { displayModes: ["inline"] } satisfies ViewConfig;

type Draft = {
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
};

export default function ComposeMessage() {
  return (
    <ThemeProvider>
      <Composer />
    </ThemeProvider>
  );
}

function Composer() {
  const theme = useViewTheme();
  const tool = useToolContext<"compose_message">();

  return (
    <div data-theme={theme} className="p-px">
      <div className="overflow-hidden rounded-box border border-line bg-surface">
        {tool.status === "ready" ? (
          <Editor output={tool.toolOutput} />
        ) : tool.status === "error" ? (
          <p className="px-4 py-3 text-danger">{tool.error.message}</p>
        ) : (
          <Pending subject={tool.toolInput?.subject} body={tool.toolInput?.body} />
        )}
      </div>
    </div>
  );
}

/** The model is still writing the email. The view shows the text that has come so far. */
function Pending({ subject, body }: { subject?: string; body?: string }) {
  return (
    <div className="animate-pulse px-4 py-3">
      <p className="font-medium">{subject || "Writing the email…"}</p>
      {body && <p className="mt-2 whitespace-pre-wrap text-muted">{body}</p>}
    </div>
  );
}

type Output = Extract<ReturnType<typeof useToolContext<"compose_message">>, { status: "ready" }>["toolOutput"];

function Editor({ output }: { output: Output }) {
  const [draft, setDraft] = useState<Draft>(() => ({
    accountId: output.account_id,
    to: output.to.join(", "),
    cc: output.cc.join(", "),
    bcc: output.bcc.join(", "),
    subject: output.subject,
    body: output.body,
  }));
  const [showCopies, setShowCopies] = useState(output.cc.length + output.bcc.length > 0);
  const [showQuoted, setShowQuoted] = useState(false);
  // The model sees this state, so it knows that the user sent the email and does not send it again.
  const [state, setState] = useViewState<{ sent: boolean; to?: string; subject?: string }>({ sent: false });
  const send = useCallTool("send_message");

  const sent = state.sent;
  const locked = sent || send.isPending;
  const set = (field: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const list = (value: string) => (value.trim() ? [value] : []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked) return;
    try {
      await send.callTool({
        account_id: draft.accountId,
        mode: output.mode,
        thread_id: output.thread_id ?? undefined,
        message_id: output.message_id ?? undefined,
        to: list(draft.to),
        cc: list(draft.cc),
        bcc: list(draft.bcc),
        subject: draft.subject,
        body: draft.body,
      });
      setState({ sent: true, to: draft.to, subject: draft.subject });
    } catch {
      // send.error shows the message.
    }
  }

  const from = output.accounts.find((a) => a.account_id === draft.accountId);

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && submit(e)}>
      <fieldset disabled={locked} className="divide-y divide-line px-4">
        <Row label="From">
          {output.accounts.length > 1 ? (
            <select
              value={draft.accountId}
              onChange={(e) => set("accountId")(e.target.value)}
              className="w-full bg-transparent py-2 outline-none"
            >
              {output.accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.email}
                </option>
              ))}
            </select>
          ) : (
            <span className="block py-2">{from?.email}</span>
          )}
        </Row>
        <Row label="To">
          <Field value={draft.to} onChange={set("to")} placeholder="Recipients" />
          {!showCopies && (
            <button
              type="button"
              onClick={() => setShowCopies(true)}
              className="shrink-0 text-xs font-medium text-muted hover:text-ink"
            >
              Cc Bcc
            </button>
          )}
        </Row>
        {showCopies && (
          <>
            <Row label="Cc">
              <Field value={draft.cc} onChange={set("cc")} />
            </Row>
            <Row label="Bcc">
              <Field value={draft.bcc} onChange={set("bcc")} />
            </Row>
          </>
        )}
        <Row label="Subject">
          <Field value={draft.subject} onChange={set("subject")} className="font-medium" />
        </Row>
        <Body value={draft.body} onChange={set("body")} />
      </fieldset>

      {output.quoted && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="rounded-md bg-field px-2 py-0.5 text-xs text-muted hover:text-ink"
          >
            {showQuoted ? "Hide the quoted text" : "Show the quoted text"}
          </button>
          {showQuoted && (
            <pre className="mt-2 max-h-48 overflow-y-auto font-sans text-xs whitespace-pre-wrap text-muted">
              {output.quoted}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-line px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-xs" role="status">
          {sent ? (
            <span className="text-success">Sent from {from?.email}.</span>
          ) : send.error ? (
            <span className="text-danger">{send.error.message}</span>
          ) : (
            <span className="text-muted">The body is Markdown.</span>
          )}
        </p>
        <button
          type="submit"
          disabled={locked || !(draft.to.trim() || draft.cc.trim() || draft.bcc.trim())}
          className="h-8 shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {sent ? "Sent" : send.isPending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      {children}
    </label>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-muted ${className}`}
    />
  );
}

/** The body grows with its text, so the host frame shows all of it. */
function Body({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Message"
      rows={4}
      className="block w-full resize-none bg-transparent py-3 leading-relaxed outline-none"
    />
  );
}
