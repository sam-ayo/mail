import { useCallback, useSyncExternalStore } from "react";

export const THEME_COLORS = { light: "#f8faff", dark: "#0d0f18" };
// Change the version when the icons change, so browsers do not show a cached icon.
export const FAVICONS = { light: "/favicon.svg?v=2", dark: "/favicon-dark.svg?v=2" };

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

// The themes. The CSS for each is in app.css. The script in root.tsx always
// sets data-palette on <html>. Without it, the indigo values in @theme apply.
export const PALETTES = [
  { id: "rose", label: "Rosé", description: "Soft, with a berry accent", font: "DM+Sans:opsz,wght@9..40,100..1000" },
  { id: "indigo", label: "Indigo", description: "Cool and quiet", font: null },
  { id: "paper", label: "Paper", description: "Warm, with a clay accent", font: "Instrument+Sans:wght@400..700" },
  { id: "sage", label: "Sage", description: "Calm green-grey", font: "Figtree:wght@300..900" },
  { id: "swiss", label: "Swiss", description: "Neutral grey, signal red", font: "Geist:wght@100..900" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const DEFAULT_PALETTE: PaletteId = "rose";

// Load the font of a theme once. Inter loads in root.tsx, so Indigo has no font here.
export function loadPaletteFont(id: PaletteId) {
  const palette = PALETTES.find((p) => p.id === id);
  if (!palette?.font || document.getElementById(`font-${palette.id}`)) return;
  const link = document.createElement("link");
  link.id = `font-${palette.id}`;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${palette.font}&display=swap`;
  document.head.appendChild(link);
}

// The theme is the data-palette attribute on <html>, as the mode is the
// "dark" class. The inline script in root.tsx sets it before the first paint.
function subscribePalette(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette"] });
  return () => observer.disconnect();
}

export function usePalette() {
  const palette = useSyncExternalStore(
    subscribePalette,
    () => (document.documentElement.getAttribute("data-palette") ?? DEFAULT_PALETTE) as PaletteId,
    () => DEFAULT_PALETTE,
  );
  const setPalette = useCallback((id: PaletteId) => {
    loadPaletteFont(id);
    document.documentElement.setAttribute("data-palette", id);
    localStorage.setItem("palette", id);
  }, []);
  return { palette, setPalette };
}
