import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui";
import type { Address, Unsubscribe } from "~/lib/mail";
import { displayName, unsubscribeMethod } from "~/lib/mail";

// Senders that you left in this session. The List-Unsubscribe header stays on
// old mail, so without this the button shows again on the next message.
const unsubscribed = new Set<string>();
const senderKey = (accountId: string, from: Address) => `${accountId}:${from.email.toLowerCase()}`;

export function isUnsubscribed(accountId: string, from: Address) {
  return unsubscribed.has(senderKey(accountId, from));
}

/**
 * Asks before it unsubscribes, because the person cannot undo it from the app.
 * A one-click request and an unsubscribe email both complete here. Only a
 * sender with a web page and no other method makes the person leave the app.
 */
export function UnsubscribeDialog({
  open,
  onOpenChange,
  accountId,
  accountEmail,
  threadId,
  messageId,
  from,
  unsubscribe,
  onDone,
  onArchive,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  accountId: string;
  accountEmail?: string;
  threadId: string;
  messageId: string;
  from: Address;
  unsubscribe: Unsubscribe;
  onDone(): void;
  /** Archives the conversation. The success toast offers it. */
  onArchive?(): void;
}) {
  const [pending, setPending] = useState(false);
  const method = unsubscribeMethod(unsubscribe);
  const sender = displayName(from);
  const you = accountEmail ?? "your address";

  async function confirm() {
    if (method === "website") {
      window.open(unsubscribe.url, "_blank", "noopener,noreferrer");
      onOpenChange(false);
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, threadId, messageId }),
      });
      const result = (await response.json()) as
        | { method: "oneClick" | "email" }
        | { method: "website"; url: string }
        | { error: string };
      if ("error" in result) throw new Error(result.error);
      if (result.method === "website") {
        window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        unsubscribed.add(senderKey(accountId, from));
        onDone();
        toast.success(`Unsubscribed from ${sender}`, {
          description: result.method === "email" ? "The unsubscribe email is in your Sent folder." : undefined,
          action: onArchive ? { label: "Archive", onClick: onArchive } : undefined,
        });
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unsubscribe");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-zinc-950/30 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <AlertDialog.Popup className="fixed inset-x-4 top-[20vh] z-50 mx-auto max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5 outline-none transition-[scale,opacity] duration-200 ease-out data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:opacity-0 dark:bg-zinc-900 dark:ring-white/10">
          <AlertDialog.Title dir="auto" className="text-lg font-semibold [overflow-wrap:anywhere]">
            Unsubscribe from {sender}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-zinc-500 [overflow-wrap:anywhere]">
            {method === "oneClick" &&
              `The app asks ${sender} to remove ${you} from this mailing list. You stay in the app.`}
            {method === "email" &&
              `The app sends an unsubscribe email from ${you} to ${sender}. The email shows in your Sent folder.`}
            {method === "website" &&
              `${sender} does not accept an unsubscribe request from the app. Open the page of ${sender} to unsubscribe.`}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close render={<Button disabled={pending} />}>Cancel</AlertDialog.Close>
            <Button variant="primary" disabled={pending} onClick={confirm}>
              {method === "website" ? "Open the page" : pending ? "Unsubscribing…" : "Unsubscribe"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
