import { EnvelopeSimple } from "~/components/icons";
import { Form } from "react-router";
import { LegalLinks } from "~/components/legal";
import { GoogleIcon, Logo, MicrosoftIcon, cx, inputClass } from "~/components/ui";

/** The card layout of the sign-in screen and the "add account" screen. */
export function SignInCard({ top, children }: { top?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-b from-accent-50/60 to-white p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] dark:from-zinc-900 dark:to-zinc-950">
      <div className="w-full max-w-md">
        {top}
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900">
          <Logo className="text-lg" />
          {children}
        </div>
        <LegalLinks className="mt-6" />
      </div>
    </main>
  );
}

export function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
    >
      {error}
    </p>
  );
}

export function ProviderButtons({
  configured,
  hint,
}: {
  configured: { google: boolean; microsoft: boolean };
  hint?: string;
}) {
  const query = hint ? `?hint=${encodeURIComponent(hint)}` : "";
  return (
    <div className="mt-6 flex flex-col gap-2.5">
      <ProviderLink href={`/auth/google${query}`} disabled={!configured.google}>
        <GoogleIcon className="size-5" /> Continue with Google
      </ProviderLink>
      <ProviderLink href={`/auth/microsoft${query}`} disabled={!configured.microsoft}>
        <MicrosoftIcon className="size-[18px]" /> Continue with Microsoft
      </ProviderLink>
    </div>
  );
}

export function ProviderLink({
  href,
  disabled = false,
  primary = false,
  children,
}: {
  href: string;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  // Use a plain anchor. OAuth redirects leave the app, so a client-side
  // navigation does not help.
  return (
    <a
      href={href}
      title={disabled ? "Add the OAuth client ID and secret to .env to turn this on" : undefined}
      className={cx(
        "relative flex h-11 items-center justify-center gap-3 rounded-xl border text-sm font-medium press",
        primary
          ? "border-accent-600 bg-accent-600 text-white hover:bg-accent-700"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
        disabled && "opacity-60",
      )}
    >
      {children}
      {disabled && (
        <span className="absolute right-3 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
          Not set up
        </span>
      )}
    </a>
  );
}

export function HostedForm({ label, email, open = false }: { label: string; email?: string; open?: boolean }) {
  return (
    <details className="group mt-4 text-sm" open={open}>
      <summary className="cursor-pointer list-none text-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        {label}
      </summary>
      <Form method="post" action="/connect/hosted" className="mt-3 flex flex-col gap-2">
        <input
          name="email"
          type="email"
          required
          defaultValue={email}
          placeholder="Address"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          className={inputClass}
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Hosted mail password"
          autoComplete="current-password"
          className={inputClass}
        />
        <button className="flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 font-medium press hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <EnvelopeSimple className="size-4" /> Continue
        </button>
      </Form>
    </details>
  );
}
