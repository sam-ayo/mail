import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // The Vercel preset puts the server build in build/server/nodejs_<hash>/.
  // `pnpm start` and the Dockerfile need build/server/index.js, so use the preset only on Vercel.
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
