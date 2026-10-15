import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const isProduction = process.env.NODE_ENV === "production";

function secret(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  isProduction,
  appUrl: (process.env.APP_URL || "http://localhost:5180").replace(/\/$/, ""),
  databaseUrl: secret("DATABASE_URL"),
  /** Vercel sends it in the Authorization header of cron job requests. */
  cronSecret: process.env.CRON_SECRET || "",
  sessionSecret: secret("SESSION_SECRET"),
  encryptionKey: secret("ENCRYPTION_KEY"),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
    tenant: process.env.MICROSOFT_TENANT || "common",
  },
  hosted: {
    /** The addresses that mail hosts. The first one also gets mail for unknown addresses at its domain. */
    mailboxes: (process.env.HOSTED_MAILBOXES || "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
    /** The password that connects a hosted address to a workspace. */
    password: process.env.HOSTED_MAIL_PASSWORD || "",
    resendApiKey: process.env.RESEND_API_KEY || "",
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",
  },
  /** VAPID keys for push notifications. Generate them with: npx web-push generate-vapid-keys */
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    /** Push services use this contact if the app sends too much. */
    subject: process.env.VAPID_SUBJECT || "mailto:mail@samayo.me",
  },
};

export const oauthConfigured = {
  google: !!(env.google.clientId && env.google.clientSecret),
  microsoft: !!(env.microsoft.clientId && env.microsoft.clientSecret),
  hosted: !!(env.hosted.mailboxes.length && env.hosted.password && env.hosted.resendApiKey),
};
