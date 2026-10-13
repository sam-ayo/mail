import { useCallback, useSyncExternalStore } from "react";

export const THEME_COLORS = { light: "#f8faff", dark: "#0d0f18" };

// The favicon is public/favicon.svg with the accent of the theme. It is a data
// URL, so a theme change needs no request and no cache version.
export function faviconHref(accent: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 3 26 26">` +
    `<rect x="3" y="3" width="26" height="26" rx="6" fill="#f4f4f5"/>` +
    `<g fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="6.25" y="8.75" width="19.5" height="14.5" rx="2.5"/><path d="M7.5 10.5l8.5 6.25 8.5-6.25"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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
// The accent is --color-accent-500 of the theme as hex, for the favicon.
export const PALETTES = [
  { id: "rose", label: "Rosé", description: "Soft, with a berry accent", font: "DM+Sans:opsz,wght@9..40,100..1000", accent: "#d8488c" },
  { id: "indigo", label: "Indigo", description: "Cool and quiet", font: null, accent: "#6366f1" },
  { id: "paper", label: "Paper", description: "Warm, with a clay accent", font: "Instrument+Sans:wght@400..700", accent: "#d6673f" },
  { id: "sage", label: "Sage", description: "Calm green-grey", font: "Figtree:wght@300..900", accent: "#3f9b65" },
  { id: "swiss", label: "Swiss", description: "Neutral grey, signal red", font: "Geist:wght@100..900", accent: "#f13936" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const DEFAULT_PALETTE: PaletteId = "rose";

// Load the font of a theme once. Inter loads in root.tsx, so Indigo has no font here.
export function paletteFavicon(id: PaletteId) {
  const palette = PALETTES.find((p) => p.id === id) ?? PALETTES[0];
  return faviconHref(palette.accent);
}

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
    document.querySelector('link[rel="icon"]')?.setAttribute("href", paletteFavicon(id));
    localStorage.setItem("palette", id);
  }, []);
  return { palette, setPalette };
}
