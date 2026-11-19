import { Desktop, Moon, Sun } from "~/components/icons";
import { useThemeMode, type ThemeMode } from "~/components/theme";
import { cx } from "~/components/ui";

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Desktop },
] satisfies { value: ThemeMode; label: string; Icon: typeof Sun }[];

/** The Light, Dark, and System control. Settings and the sign-in screen show it. */
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
