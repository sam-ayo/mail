import { Desktop, Moon, Sun } from "~/components/icons";
import { useTheme, useThemeMode, type ThemeMode } from "~/components/theme";
import { cx } from "~/components/ui";

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Desktop },
] satisfies { value: ThemeMode; label: string; Icon: typeof Sun }[];

/** The Light, Dark, and System control in Settings. */
export function ThemeModeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useThemeMode();
  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      className={cx("flex shrink-0 gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900", className)}
    >
      {MODES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => setMode(value)}
          className={cx(
            "press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm",
            mode === value
              ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
          )}
        >
          <Icon className="size-4" /> {label}
        </button>
      ))}
    </div>
  );
}

/** One button that changes between light and dark mode. The sign-in screen shows it. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      title={dark ? "Use light mode" : "Use dark mode"}
      className={cx(
        "press grid size-9 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        className,
      )}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
