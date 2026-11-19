import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vitest does not load the React Router plugin of vite.config.ts.
export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) } },
  test: { include: ["app/**/*.test.ts"] },
});
