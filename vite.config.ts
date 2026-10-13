import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // The OAuth redirect URIs use this port, so do not fall back to another one.
  server: { port: 5180, strictPort: true },
  resolve: {
    tsconfigPaths: true,
  },
  // Bundle all server dependencies. sanitize-html uses require() to load
  // htmlparser2, which is ES module only, and Vercel's runtime rejects that.
  ssr: { noExternal: true },
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
});
