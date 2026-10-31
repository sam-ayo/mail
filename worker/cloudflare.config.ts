// Calls the mail check of the app each 20 minutes. The Vercel Hobby plan runs cron
// jobs only once a day. Neon Free has 100 compute hours each month and suspends the
// compute after 5 idle minutes. A check each minute kept the compute active and used
// all of the quota, so the interval must stay much longer than 5 minutes.
// Deploy with: pnpm install && cf deploy
// Set the secret with: cf workers secrets update CRON_SECRET --worker relay-mail-cron --text <value>
import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "relay-mail-cron",
    compatibilityDate: "2026-10-06",
    entrypoint,
    // The Worker has no public URL. Only the cron trigger runs it.
    workersDev: false,
    previewUrls: false,
    // Workers Logs keep each run and its result, so a failed check shows in the dashboard.
    observability: { enabled: true },
    triggers: [triggers.scheduled({ schedule: "*/20 * * * *" })],
    env: {
      CHECK_URL: bindings.text("https://mail.samayo.me/api/cron/check-mail"),
      CRON_SECRET: bindings.secret(),
    },
  },
});
