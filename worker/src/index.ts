import { env } from "cloudflare:workers";

// The cron trigger in cloudflare.config.ts runs this each 20 minutes.
export default {
  async scheduled() {
    const response = await fetch(env.CHECK_URL, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    if (!response.ok) throw new Error(`Mail check failed: HTTP ${response.status}`);
    console.log(await response.text());
  },
} satisfies ExportedHandler;
