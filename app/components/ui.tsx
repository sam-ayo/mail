import { Tooltip } from "@base-ui/react/tooltip";
import { clsx } from "clsx";
import { useState } from "react";
import { EnvelopeSimple, HardDrives, Sparkle } from "./icons";
import { shownProvider, type ProviderKind } from "~/lib/mail";

export const cx = clsx;

// The mark is an envelope on a rounded square. Keep public/favicon.svg and faviconHref in theme.ts the same.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-500">
        <rect x="6.75" y="9.25" width="18.5" height="13.5" rx="2.25" />
        <path d="M7.75 10.75l8.25 6 8.25-6" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center text-[17px] font-bold tracking-[-0.04em]", className)}>
      {/* The envelope has empty space at its sides, so the label moves into it. */}
      <LogoMark className="-mr-0.5 size-7" />
      <span>
        mail<span className="text-accent-500">.</span>
      </span>
    </div>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

export function ProviderIcon({ provider, className }: { provider: ProviderKind; className?: string }) {
  switch (provider) {
    case "google":
      return <GoogleIcon className={className} />;
    case "microsoft":
      return <MicrosoftIcon className={className} />;
    case "imap":
      return <HardDrives className={className} />;
    case "hosted":
      return <EnvelopeSimple className={className} />;
    case "demo":
      return <Sparkle className={className} />;
  }
}

/**
 * The company logo for an account at a custom domain, such as name@acme.com.
 * The provider icon shows until the logo loads, and stays when there is no logo.
 */
export function AccountIcon({
  account,
  className,
}: {
  account: { email: string; provider: ProviderKind; look?: ProviderKind };
  className?: string;
}) {
  const provider = shownProvider(account);
  const domain = account.email.slice(account.email.lastIndexOf("@") + 1).toLowerCase();
  // A list can show a different account later, so keep the domain with the result.
  const [logo, setLogo] = useState<{ domain: string; loaded: boolean }>();
  const loaded = logo?.domain === domain && logo.loaded;
  const hasLogo = provider !== "demo" && domain !== "" && !(logo?.domain === domain && !logo.loaded);
  return (
    <span className={cx("relative inline-block shrink-0", className)}>
      {!loaded && <ProviderIcon provider={provider} className="block size-full" />}
      {hasLogo && (
        <img
          key={domain}
          src={`/api/avatar?domain=${encodeURIComponent(domain)}`}
          alt=""
          // The image can load before hydration, and then React gets no load event.
          ref={(image) => {
            if (image?.complete && image.naturalWidth > 0 && !loaded) setLogo({ domain, loaded: true });
          }}
          onLoad={() => setLogo({ domain, loaded: true })}
          onError={() => setLogo({ domain, loaded: false })}
          className={cx("absolute inset-0 size-full rounded-[3px] object-contain", !loaded && "invisible")}
        />
      )}
    </span>
  );
}

export const PROVIDER_NAMES: Record<ProviderKind, string> = {
  google: "Gmail",
  microsoft: "Outlook",
  imap: "IMAP",
  hosted: "Hosted",
  demo: "Demo",
};

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** The first user-perceived character. An emoji or an accented letter stays whole. */
function firstGrapheme(word: string) {
  if (!segmenter) return Array.from(word)[0] ?? "";
  return segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? "";
}

/**
 * Initials from the first and last word of the name ("Christopher Alexander
 * Montgomery III" gives "CM"), or from the email when there is no name.
 */
export function initialsFor(name: string | undefined, email: string) {
  const allWords = (name ?? "").trim().split(/\s+/).filter(Boolean);
  // Skip emoji words ("🦊 Fox" gives "F"), unless the name is only emoji.
  const letterWords = allWords.filter((word) => /\p{L}/u.test(word));
  const words = (letterWords.length ? letterWords : allWords)
    .filter((word) => !/^(I{1,3}|IV|Jr\.?|Sr\.?)$/.test(word));
  if (words.length === 0) {
    const local = email.split("@")[0] ?? "";
    return firstGrapheme(local).toUpperCase() || "?";
  }
  const first = firstGrapheme(words[0]!);
  // CJK names have no spaces. One character is enough.
  if (words.length === 1 || /\p{Script=Han}/u.test(first)) return first.toUpperCase();
  return (first + firstGrapheme(words[words.length - 1]!)).toUpperCase();
}

export function Avatar({
  name,
  email,
  color,
  size = "md",
}: {
  name?: string;
  email: string;
  color?: string;
  size?: "sm" | "md" | "lg";
}) {
  const hue = [...email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  // The initials show until the logo loads, and stay when the server has no logo.
  // A list row can show a different sender later, so keep the email with the result.
  const [logo, setLogo] = useState<{ email: string; loaded: boolean }>();
  const loaded = logo?.email === email && logo.loaded;
  const hasLogo = email.includes("@") && !(logo?.email === email && !logo.loaded);
  return (
    <span
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white select-none",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-10 text-sm",
      )}
      style={{ background: color ?? `hsl(${hue} 55% 52%)` }}
      aria-hidden
    >
      {initialsFor(name, email)}
      {hasLogo && (
        <img
          key={email}
          src={`/api/avatar?email=${encodeURIComponent(email)}`}
          alt=""
          // The image can load before hydration, and then React gets no load event.
          ref={(image) => {
            if (image?.complete && image.naturalWidth > 0 && !loaded) setLogo({ email, loaded: true });
          }}
          onLoad={() => setLogo({ email, loaded: true })}
          onError={() => setLogo({ email, loaded: false })}
          className={cx(
            "absolute inset-0 size-full bg-white object-cover",
            !loaded && "invisible",
          )}
        />
      )}
    </span>
  );
}

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cx(
        "press inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-accent-600 text-white shadow-sm hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
        variant === "secondary" &&
          "bg-white text-zinc-700 shadow-xs ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-zinc-800",
        variant === "ghost" &&
          "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shared tooltip timing. The first tooltip waits, so a passing pointer does
 * not open it. After that, neighbours open at once and with no animation.
 */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delay={500} closeDelay={0}>
      {children}
    </Tooltip.Provider>
  );
}

export function Hint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  /** The trigger element. It must accept a ref and props. */
  children: React.ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} className="z-[60]">
          <Tooltip.Popup className="flex origin-(--transform-origin) items-center gap-1.5 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white shadow-lg transition-[scale,opacity] duration-[125ms] ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 dark:bg-zinc-100 dark:text-zinc-900">
            {label}
            {shortcut && (
              <kbd className="border-white/15 bg-white/10 text-white/70 dark:border-black/10 dark:bg-black/5 dark:text-zinc-500">
                {shortcut}
              </kbd>
            )}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function IconButton({
  label,
  shortcut,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string }) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        className={cx(
          "press grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Hint>
  );
}

/**
 * A file name that truncates in the middle. The start and the extension stay
 * visible, because file names often differ only at the end ("…v12-final.pdf").
 */
export function FileName({ name, className }: { name: string; className?: string }) {
  const dot = name.lastIndexOf(".");
  const tail = dot > 0 && name.length - dot <= 6 ? 6 + (name.length - dot) : 8;
  const head = name.slice(0, Math.max(0, name.length - tail));
  const end = name.slice(head.length);
  return (
    <span title={name} className={cx("flex min-w-0", className)}>
      <span className="truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{end}</span>
    </span>
  );
}

export const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-zinc-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-zinc-700 dark:bg-zinc-900";
