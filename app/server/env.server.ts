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
  /** Old encryption keys, separated by commas. They only decrypt. See "Rotate the encryption key" in README.md. */
  previousEncryptionKeys: (process.env.ENCRYPTION_KEY_PREVIOUS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
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
    /** The addresses that mail by samayo hosts. The first one also gets mail for unknown addresses at its domain. */
    mailboxes: (process.env.HOSTED_MAILBOXES || "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
    /** The password that connects a hosted address to a workspace. */
    password: process.env.HOSTED_MAIL_PASSWORD || "",
    resendApiKey: process.env.RESEND_API_KEY || "",
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",
  },
  /**
   * The password of the reviewer sign-in at /review. Directory reviewers of
   * Claude and ChatGPT use it to get a workspace with sample mail. Empty turns
   * the sign-in off.
   */
  reviewPassword: process.env.REVIEW_PASSWORD || "",
  /** The token that ChatGPT asks for at /.well-known/openai-apps-challenge to verify the domain. */
  openaiAppsChallenge: process.env.OPENAI_APPS_CHALLENGE || "",
  /** The API key of TypeSafe. Its model Jev does the AI sorting of the inbox. Empty turns AI sorting off. */
  typesafeApiKey: process.env.TYPESAFE_API_KEY || "",
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
