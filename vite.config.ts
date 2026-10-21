import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { mcpUse } from "mcp-use/vite";
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

export default defineConfig(({ command }) => ({
  // mcpUse() must come before the framework plugins. See app/mcp/server.ts.
  plugins: [
    notInChildCompiler(mcpUse({ entry: "app/mcp/server.ts", viewsDir: "app/mcp/views" })),
    viewRefreshPreamble,
    tailwindcss(),
    reactRouter(),
  ],
  // The OAuth redirect URIs use this port, so do not fall back to another one.
  server: { port: 5180, strictPort: true },
  resolve: {
    tsconfigPaths: true,
  },
  // Bundle all server dependencies. sanitize-html uses require() to load
  // htmlparser2, which is ES module only, and Vercel's runtime rejects that.
  // Do this only for the build. The dev module runner cannot run CommonJS
  // packages such as react when it inlines them.
  ssr: command === "build" ? { noExternal: true } : {},
  optimizeDeps: {
    include: [
      "lucide-react",
      "sonner",
      "cmdk",
      "react-virtuoso",
      "clsx",
      "@base-ui/react/dialog",
      "@base-ui/react/drawer",
      "@base-ui/react/tooltip",
      "@base-ui/react/context-menu",
    ],
    // Only server modules import these packages. Without this list, the dev
    // dependency scan bundles them for the browser and reloads the page.
    exclude: ["imapflow", "mailparser", "nodemailer", "sanitize-html"],
  },
}));
