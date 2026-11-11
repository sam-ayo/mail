import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { mcpUse } from "mcp-use/vite";
import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type PluginOption } from "vite";

/**
 * React Router compiles route exports in a child Vite server. That server gets
 * a copy of the config and of all plugins except its own. mcp-use rejects a
 * config that already has its environment, so it runs only in the main server.
 */
function notInChildCompiler(plugins: PluginOption[]): PluginOption[] {
  for (const plugin of (plugins as unknown[]).flat(Infinity) as Plugin[]) {
    if (!plugin || typeof plugin !== "object") continue;
    // Set it on the plugin itself. mcp-use changes its plugin objects after it creates them.
    const apply = plugin.apply;
    plugin.apply = (config, env) =>
      config.cacheDir !== "node_modules/.vite-child-compiler" &&
      (typeof apply === "function" ? apply(config, env) : !apply || apply === env.command);
  }
  return plugins;
}

/**
 * In dev, mcp-use views import the React Fast Refresh preamble of
 * @vitejs/plugin-react. React Router has its own refresh runtime and
 * transform, so use its preamble instead.
 */
const viewRefreshPreamble: Plugin = {
  name: "mcp-view-refresh-preamble",
  enforce: "pre",
  apply: "serve",
  resolveId(id) {
    if (id === "@vitejs/plugin-react/preamble") return this.resolve("virtual:react-router/inject-hmr-runtime");
  },
};

/**
 * Bundle all server dependencies. sanitize-html uses require() to load
 * htmlparser2, which is ES module only, and Vercel's runtime rejects that.
 * Do this only for the build. The dev module runner cannot run CommonJS
 * packages such as react when it inlines them. On Vercel, the Vercel preset
 * builds the server in "ssrBundle_*" environments and not in "ssr", so the
 * `ssr` option does not apply there. sharp stays external, because it loads
 * a native binary from its own package folder.
 */
const bundleServerDependencies: Plugin = {
  name: "bundle-server-dependencies",
  apply: "build",
  configEnvironment(name) {
    if (name === "ssr" || name.startsWith("ssrBundle_")) return { resolve: { noExternal: true, external: ["sharp"] } };
  },
};

/**
 * Serve the standard fonts of pdf.js at /pdfjs-fonts/. pdf.js uses them in
 * place of fonts that a PDF does not include. XFA forms need them to measure
 * text; without them, the lines of a form overlap. pdf.js loads each font
 * from this folder by its file name, so the names must not get a hash.
 */
const pdfFontsDir = fileURLToPath(new URL("node_modules/pdfjs-dist/standard_fonts/", import.meta.url));
const pdfFonts: Plugin = {
  name: "pdfjs-standard-fonts",
  configureServer(server) {
    server.middlewares.use("/pdfjs-fonts/", (req, res, next) => {
      const name = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\//, "");
      if (!readdirSync(pdfFontsDir).includes(name)) return next();
      res.setHeader("Content-Type", "application/octet-stream");
      createReadStream(pdfFontsDir + name).pipe(res);
    });
  },
  generateBundle() {
    if (this.environment.name !== "client") return;
    for (const name of readdirSync(pdfFontsDir)) {
      this.emitFile({ type: "asset", fileName: `pdfjs-fonts/${name}`, source: readFileSync(pdfFontsDir + name) });
    }
  },
};

export default defineConfig({
  // mcpUse() must come before the framework plugins. See app/mcp/server.ts.
  plugins: [
    notInChildCompiler(mcpUse({ entry: "app/mcp/server.ts", viewsDir: "app/mcp/views" })),
    viewRefreshPreamble,
    pdfFonts,
    tailwindcss(),
    // This must come before reactRouter(), which reads `resolve.noExternal`.
    bundleServerDependencies,
    reactRouter(),
  ],
  // The OAuth redirect URIs use this port, so do not fall back to another one.
  server: { port: 5180, strictPort: true },
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: [
      "sonner",
      "cmdk",
      "react-virtuoso",
      "clsx",
      "@base-ui/react/dialog",
      "@base-ui/react/drawer",
      "@base-ui/react/tooltip",
      "@base-ui/react/context-menu",
      "@base-ui/react/autocomplete",
      "@base-ui/react/collapsible",
      "pdfjs-dist",
    ],
    // Only server modules import these packages. Without this list, the dev
    // dependency scan bundles them for the browser and reloads the page.
    exclude: ["@typesafe-ai/sdk", "@vercel/functions", "imapflow", "mailparser", "nodemailer", "sanitize-html", "sharp"],
  },
});
