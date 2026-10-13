import { EnvelopeSimple } from "@phosphor-icons/react";

export default function NoThreadSelected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50/50 p-8 text-center dark:bg-zinc-950">
      <span className="grid size-14 place-items-center rounded-2xl bg-white text-zinc-300 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-600 dark:ring-zinc-800">
        <EnvelopeSimple className="size-6" />
      </span>
      <div>
        <p className="font-medium text-zinc-700 dark:text-zinc-200">No conversation selected</p>
        <p className="mt-1 text-sm text-zinc-500">
          Use <kbd>j</kbd> and <kbd>k</kbd> to move, and <kbd>↵</kbd> to open.
        </p>
      </div>
      <p className="text-xs text-zinc-400">
        Press <kbd>⌘</kbd> <kbd>K</kbd> for commands, or <kbd>?</kbd> for all shortcuts.
      </p>
    </div>
  );
}
