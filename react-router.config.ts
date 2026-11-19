import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // The Vercel preset puts the server build in build/server/nodejs_<hash>/.
  // `pnpm start` and the Dockerfile need build/server/index.js, so use the preset only on Vercel.
  presets: process.env.VERCEL ? [vercelPreset()] : [],
  // Caddy sends HTTPS requests to the app over HTTP, and react-router-serve does not trust X-Forwarded-Proto.
  // Thus request.url starts with "http:", and React Router stops each action from the https: page with 400.
  // These hosts are the hosts of the app, so their actions can run.
  allowedActionOrigins: ["mail.samayo.me", "mail.demo.samayo.me"],
} satisfies Config;
