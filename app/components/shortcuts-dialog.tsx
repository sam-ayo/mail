import { Dialog } from "@base-ui/react/dialog";
import { X } from "@phosphor-icons/react";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Navigation",
    items: [
      ["j or k", "Next or previous conversation"],
      ["home or end", "First or last conversation"],
      ["o or ↵", "Open conversation"],
      ["esc", "Back to the list"],
      ["/", "Search"],
      ["⌘ K", "Command palette"],
      ["⇧ R", "Check for new mail"],
      ["⇧ F10", "Open the menu for a conversation"],
      ["⌘ \\", "Show or hide the sidebar"],
    ],
  },
  {
    title: "Go to",
    items: [
      ["g then i", "Inbox"],
      ["g then s", "Starred"],
      ["g then t", "Sent"],
      ["g then d", "Drafts"],
      ["g then a", "Archive"],
      ["g then !", "Spam"],
      ["g then #", "Trash"],
      ["g then 1–9", "Account 1 to 9"],
      ["g then 0", "All accounts"],
      ["g then ,", "Settings"],
    ],
  },
  {
    title: "Actions",
    items: [
      ["e", "Archive"],
      ["]", "Archive, then open the next one"],
      ["[", "Archive, then open the previous one"],
      ["#", "Move to Trash"],
      ["!", "Mark as spam"],
      ["s", "Star or unstar"],
      ["⇧ I", "Mark as read"],
      ["u", "Mark as unread"],
      ["z", "Undo the last action"],
    ],
  },
  {
    title: "Selection",
    items: [
      ["x", "Select conversation"],
      ["* then a", "Select all"],
      ["* then n", "Select none"],
      ["* then r", "Select read"],
      ["* then u", "Select unread"],
      ["* then s", "Select starred"],
      ["* then t", "Select unstarred"],
    ],
  },
  {
    title: "Conversation",
    items: [
      [";", "Expand all messages"],
      [":", "Collapse all messages"],
      ["r", "Reply"],
      ["a", "Reply all"],
      ["f", "Forward"],
    ],
  },
  {
    title: "Writing",
    items: [
      ["c", "New message"],
      ["⌘ ↵", "Send"],
      ["⌘ ⇧ C", "Add Cc"],
      ["⌘ ⇧ B", "Add Bcc"],
      ["⌘ ⇧ E", "Larger or smaller window"],
    ],
  },
];

/**
 * A modal, so it scales from the center, not from a trigger. It opens a few
 * times at most, so a short standard animation is fine here.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-zinc-950/30 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-x-4 top-[12vh] z-50 mx-auto max-h-[76vh] max-w-4xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5 outline-none transition-[scale,opacity] duration-200 ease-out data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:opacity-0 dark:bg-zinc-900 dark:ring-white/10">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="press grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <p className="-mt-2 mb-5 text-sm text-zinc-500">
            Right-click a conversation, a message, a folder, or an account for more actions.
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                  {group.title}
                </h3>
                <dl className="space-y-1.5 text-sm">
                  {group.items.map(([keys, description]) => (
                    <div key={keys} className="flex items-center justify-between gap-3">
                      <dt className="text-zinc-600 dark:text-zinc-300">{description}</dt>
                      <dd className="flex shrink-0 gap-1">
                        {keys.split(" ").map((key, i) =>
                          key === "then" || key === "or" ? (
                            <span key={i} className="text-xs text-zinc-400">
                              {key}
                            </span>
                          ) : (
                            <kbd key={i}>{key}</kbd>
                          ),
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
