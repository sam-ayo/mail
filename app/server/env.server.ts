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
};

export const oauthConfigured = {
  google: !!(env.google.clientId && env.google.clientSecret),
  microsoft: !!(env.microsoft.clientId && env.microsoft.clientSecret),
};
