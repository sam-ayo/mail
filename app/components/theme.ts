import { useCallback, useSyncExternalStore } from "react";

export const THEME_COLORS = { light: "#f8faff", dark: "#0d0f18" };
export const FAVICONS = { light: "/favicon.svg", dark: "/favicon-dark.svg" };

// The theme is the "dark" class on <html>. The inline script in root.tsx sets
// it before the first paint, so read the class and do not copy it into state.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useTheme() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    // The status bar on phones takes its colour from theme-color.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next ? THEME_COLORS.dark : THEME_COLORS.light);
    // The light mark is dark, so it disappears on a dark tab bar.
    document.querySelector('link[rel="icon"]')?.setAttribute("href", next ? FAVICONS.dark : FAVICONS.light);
    localStorage.setItem("theme", next ? "dark" : "light");
  }, []);
  return { dark, toggle };
}
