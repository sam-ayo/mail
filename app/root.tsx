import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { useTheme } from "./components/theme";
import { themeScript } from "./lib/theme-script";
import { ConfirmProvider } from "./components/confirm-dialog";
import { TooltipProvider } from "./components/ui";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  // The manifest and the touch icon let a phone add the app to the home screen.
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

export const meta: Route.MetaFunction = () => [{ title: "mail by samayo" }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        {/* iOS opens the app from the home screen without the Safari bars.
            These tags are here and not in meta, because a route meta replaces
            the root meta. With a translucent status bar, the pages go under
            it, as in a native app. Each page leaves space for it with
            env(safe-area-inset-top). */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="mail by samayo" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// The service worker keeps the app usable offline and shows notifications. It
// is off in development, because its saved files would hide code changes.
function useServiceWorker() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then(async () => {
      const registration = await navigator.serviceWorker.ready;
      // This page and its files loaded before the service worker started. Save them too.
      const urls = [
        location.href,
        ...performance.getEntriesByType("resource").map((entry) => entry.name),
      ];
      registration.active?.postMessage({ type: "cache-urls", urls });
    }, (error) => console.error("Service worker registration failed", error));

    // A click on a notification opens its thread in the window that is open.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "open-url") return;
      const url = new URL(event.data.url);
      if (url.origin === location.origin) navigate(url.pathname + url.search);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
}

export default function App() {
  const { dark } = useTheme();
  useServiceWorker();
  return (
    <TooltipProvider>
      <ConfirmProvider>
        <Outlet />
      </ConfirmProvider>
      {/* One Toaster for the whole app. Bottom center is far from the
          sidebar and the compose window. */}
      <Toaster
        theme={dark ? "dark" : "light"}
        position="bottom-center"
        offset={{ bottom: "calc(24px + env(safe-area-inset-bottom, 0px))" }}
        // On a phone the toolbar is at the bottom, so the toast shows above it.
        mobileOffset={{ bottom: "calc(60px + env(safe-area-inset-bottom, 0px))" }}
        toastOptions={{ classNames: { toast: "!font-sans" } }}
      />
    </TooltipProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    details =
      error.status === 404
        ? "The page does not exist."
        : typeof error.data === "string"
          ? error.data
          : error.statusText || details;
  } else if (error instanceof Error) {
    details = import.meta.env.DEV ? error.message : details;
    stack = import.meta.env.DEV ? error.stack : undefined;
  }

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-3 p-8 pt-[calc(2rem+env(safe-area-inset-top))]">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="text-zinc-500">{details}</p>
      <Link to="/mail" className="text-sm font-medium text-accent-600">
        Go to your inbox
      </Link>
      {stack && (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs dark:bg-zinc-900">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
