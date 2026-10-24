import { Link } from "react-router";
import { Logo } from "./ui";

export const CONTACT_EMAIL = "samuelayomideadeoye@gmail.com";
export const UPDATED = "24 October 2026";

/** The layout for the public privacy policy and terms of service pages. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-white px-6 py-12 pt-[calc(3rem+env(safe-area-inset-top))] dark:bg-zinc-950">
      <article className="mx-auto max-w-2xl text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 [&_a]:text-accent-600 [&_a]:underline [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-900 dark:[&_h2]:text-zinc-100 [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        <Link to="/">
          <Logo />
        </Link>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h1>
        <p className="text-sm text-zinc-500">Last updated: {UPDATED}</p>
        {children}
        <LegalLinks className="mt-12" />
      </article>
    </main>
  );
}

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav className={`flex justify-center gap-4 text-xs text-zinc-400 ${className ?? ""}`}>
      <Link to="/privacy" className="hover:text-zinc-700 dark:hover:text-zinc-200">
        Privacy policy
      </Link>
      <Link to="/terms" className="hover:text-zinc-700 dark:hover:text-zinc-200">
        Terms of service
      </Link>
      <Link to="/agents" className="hover:text-zinc-700 dark:hover:text-zinc-200">
        AI agents
      </Link>
    </nav>
  );
}
