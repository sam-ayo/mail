import { ContextMenu as Base } from "@base-ui/react/context-menu";
import { toast } from "sonner";
import { cx } from "./ui";

export type MenuEntry =
  | {
      label: string;
      icon?: React.ComponentType<{ className?: string }>;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect(): void;
    }
  | "separator"
  | false
  | null
  | undefined;

/**
 * A right-click menu. A long press opens it on touch screens. `items` is a
 * function, so a list of many rows builds menu items only for the open menu.
 * The menu opens with no delay and a very short fade, because people open it
 * many times a day.
 */
export function ContextMenu({
  items,
  children,
  onOpenChange,
  disabled,
}: {
  items(): MenuEntry[];
  /** The trigger element. It must accept a ref and props. */
  children: React.ReactElement<Record<string, unknown>>;
  onOpenChange?(open: boolean): void;
  /** No menu opens, and the trigger does not catch touches. */
  disabled?: boolean;
}) {
  return (
    <Base.Root disabled={disabled} onOpenChange={(open) => onOpenChange?.(open)}>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner className="z-[60] outline-none">
          <Base.Popup className="min-w-52 origin-(--transform-origin) rounded-xl bg-white p-1 text-sm shadow-xl ring-1 ring-black/5 outline-none transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-zinc-900 dark:ring-white/10">
            <MenuItems items={items()} />
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

function MenuItems({ items }: { items: MenuEntry[] }) {
  // Remove empty entries, and separators at the start, at the end, or next to another separator.
  const entries = items.filter(Boolean).filter((entry, i, list) => {
    if (entry !== "separator") return true;
    return i > 0 && i < list.length - 1 && list[i - 1] !== "separator";
  });
  return (
    <>
      {entries.map((entry, i) => {
        if (!entry) return null;
        if (entry === "separator") {
          return <Base.Separator key={i} className="mx-2 my-1 h-px bg-zinc-100 dark:bg-zinc-800" />;
        }
        const Icon = entry.icon;
        return (
          <Base.Item
            key={i}
            label={entry.label}
            disabled={entry.disabled}
            onClick={entry.onSelect}
            className={cx(
              "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 outline-none select-none data-disabled:opacity-40",
              entry.danger
                ? "text-red-600 data-highlighted:bg-red-50 dark:text-red-400 dark:data-highlighted:bg-red-500/10"
                : "text-zinc-700 data-highlighted:bg-zinc-100 dark:text-zinc-200 dark:data-highlighted:bg-zinc-800",
            )}
          >
            {Icon ? <Icon className="size-4 shrink-0 opacity-60" /> : <span className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.shortcut && <kbd className="ml-4">{entry.shortcut}</kbd>}
          </Base.Item>
        );
      })}
    </>
  );
}

/** Copies text to the clipboard and shows a short confirmation. */
export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`, { id: "copy", duration: 2000 });
  } catch {
    toast.error("Could not copy to the clipboard");
  }
}

/**
 * Opens the context menu of an element from the keyboard (Shift+F10 or the
 * Menu key), as if the person right-clicked its top-left corner.
 */
export function openContextMenuAt(element: Element | null) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 24,
      clientY: rect.top + rect.height / 2,
      button: 2,
    }),
  );
}
