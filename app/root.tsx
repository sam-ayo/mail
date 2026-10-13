import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { Toaster } from "sonner";
import { DEFAULT_PALETTE, PALETTES, THEME_COLORS, paletteFavicon, useTheme } from "./components/theme";
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
];

export const meta: Route.MetaFunction = () => [{ title: "mail" }];

// Set the theme before the first paint, so the page does not flash.
const themeScript = `(() => {
  try {
    // The script makes these tags, and React does not render them. React
    // matches head tags by their attributes when it hydrates. A tag that this
    // script changed has no match, so React adds a copy with the old value.
    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    document.head.append(themeColor, icon);
    // No stored mode means the system mode, which follows the system setting.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const stored = localStorage.getItem("theme");
      const dark = stored === "dark" || (stored !== "light" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      themeColor.content = dark ? "${THEME_COLORS.dark}" : "${THEME_COLORS.light}";
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    const width = Number(localStorage.getItem("sidebar-width"));
    if (width >= 180 && width <= 360) document.documentElement.style.setProperty("--sidebar-width", width + "px");
    const listWidth = Number(localStorage.getItem("list-width"));
    if (listWidth >= 300 && listWidth <= 720) document.documentElement.style.setProperty("--list-width", listWidth + "px");
    if (localStorage.getItem("sidebar-collapsed") === "1") document.documentElement.classList.add("sidebar-collapsed");
    if (localStorage.getItem("list-collapsed") === "1") document.documentElement.classList.add("list-collapsed");
    const palettes = ${JSON.stringify(PALETTES.map(({ id, font }) => ({ id, font, icon: paletteFavicon(id) })))};
    const palette = palettes.find((p) => p.id === localStorage.getItem("palette"))
      || palettes.find((p) => p.id === "${DEFAULT_PALETTE}");
    document.documentElement.setAttribute("data-palette", palette.id);
    icon.href = palette.icon;
    if (palette.font) {
      const link = document.createElement("link");
      link.id = "font-" + palette.id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=" + palette.font + "&display=swap";
      document.head.appendChild(link);
    }
  } catch {}
})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
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

export default function App() {
  const { dark } = useTheme();
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
        mobileOffset={{ bottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
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
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-3 p-8">
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
