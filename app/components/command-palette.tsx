import { Command as Cmdk } from "cmdk";
import { MagnifyingGlass } from "./icons";

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  run(): void;
}

/**
 * The ⌘K palette. It has no open or close animation: people open it from the
 * keyboard many times a day, and motion would make it feel slow.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose(): void;
  commands: Command[];
}) {
  const groups = [...new Set(commands.map((command) => command.group))];

  return (
    <Cmdk.Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      label="Command palette"
      loop
      overlayClassName="fixed inset-0 z-50 bg-zinc-950/30"
      contentClassName="fixed inset-x-4 top-[15vh] z-50 mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
    >
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-zinc-800">
        <MagnifyingGlass className="size-4 shrink-0 text-zinc-400" />
        <Cmdk.Input
          autoFocus
          placeholder="Type a command or search…"
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
        />
        <kbd>esc</kbd>
      </div>
      <Cmdk.List className="max-h-80 scroll-py-2 overflow-y-auto overscroll-contain p-2">
        <Cmdk.Empty className="px-3 py-6 text-center text-sm text-zinc-500">
          No matching commands
        </Cmdk.Empty>
        {groups.map((group) => (
          <Cmdk.Group
            key={group}
            heading={group}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-400 [&_[cmdk-group-heading]]:uppercase"
          >
            {commands
              .filter((command) => command.group === group)
              .map((command) => {
                const Icon = command.icon;
                return (
                  <Cmdk.Item
                    key={command.id}
                    value={`${command.group} ${command.label}`}
                    onSelect={() => {
                      onClose();
                      command.run();
                    }}
                    className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm select-none data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800"
                  >
                    {Icon && <Icon className="size-4 shrink-0 text-zinc-400" />}
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint && <kbd>{command.hint}</kbd>}
                  </Cmdk.Item>
                );
              })}
          </Cmdk.Group>
        ))}
      </Cmdk.List>
    </Cmdk.Dialog>
  );
}
