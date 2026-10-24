import { DEFAULT_PALETTE, PALETTES, RENAMED_PALETTES, THEME_COLORS, paletteFavicon } from "~/components/theme";

// Set the theme before the first paint, so the page does not flash.
export const themeScript = `(() => {
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
    const stored = localStorage.getItem("palette");
    const renamed = ${JSON.stringify(RENAMED_PALETTES)};
    const palette = palettes.find((p) => p.id === (renamed[stored] || stored))
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
