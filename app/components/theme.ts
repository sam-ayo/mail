import { useCallback, useSyncExternalStore } from "react";

export const THEME_COLORS = { light: "#f8faff", dark: "#0d0f18" };
// Change the version when the icons change, so browsers do not show a cached icon.
export const FAVICONS = { light: "/favicon.svg?v=2", dark: "/favicon-dark.svg?v=2" };

// The mode is "light", "dark", or "system". It is in storage, and no value
// there means "system". The inline script in root.tsx sets the "dark" class on
// <html> before the first paint. It also follows the system setting when it
// changes, so the system mode needs no code here.
export type ThemeMode = "light" | "dark" | "system";

const MODE_KEY = "theme";
const MODE_EVENT = "theme:mode";

function readMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function systemDark() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  // The status bar on phones takes its colour from theme-color.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
  // The light mark is dark, so it disappears on a dark tab bar.
  document.querySelector('link[rel="icon"]')?.setAttribute("href", dark ? FAVICONS.dark : FAVICONS.light);
}

export function setThemeMode(mode: ThemeMode) {
  if (mode === "system") localStorage.removeItem(MODE_KEY);
  else localStorage.setItem(MODE_KEY, mode);
  applyDark(mode === "system" ? systemDark() : mode === "dark");
  window.dispatchEvent(new Event(MODE_EVENT));
}

function subscribeMode(onChange: () => void) {
  window.addEventListener(MODE_EVENT, onChange);
  return () => window.removeEventListener(MODE_EVENT, onChange);
}

export function useThemeMode() {
  const mode = useSyncExternalStore(subscribeMode, readMode, () => "system" as const);
  return { mode, setMode: setThemeMode };
}

// Read the class and do not copy it into state, because the inline script
// can change it.
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
  // A toggle sets a fixed mode, also from the system mode.
  const toggle = useCallback(() => {
    setThemeMode(document.documentElement.classList.contains("dark") ? "light" : "dark");
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
