import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("auth/:provider", "routes/auth.start.tsx"),
  route("auth/:provider/callback", "routes/auth.callback.tsx"),
  route("connect/demo", "routes/connect.demo.tsx"),
  route("connect/hosted", "routes/connect.hosted.tsx"),
  route("logout", "routes/logout.tsx"),
  route("oauth/login", "routes/oauth.login.tsx"),
  route("oauth/consent", "routes/oauth.consent.tsx"),

  layout("routes/app.tsx", [
    route("mail", "routes/mail.redirect.tsx"),
    route("mail/:scope/:folder", "routes/mail.list.tsx", [
      index("routes/mail.empty.tsx"),
      route(":accountId/:threadId", "routes/mail.thread.tsx"),
    ]),
    route("settings", "routes/settings.tsx"),
  ]),

  route("api/threads", "routes/api.threads.ts"),
  route("api/send", "routes/api.send.ts"),
  route("api/attachments/:accountId", "routes/api.attachments.ts"),
  route("api/counts", "routes/api.counts.ts"),
  route("api/avatar", "routes/api.avatar.ts"),
  route("api/unsubscribe", "routes/api.unsubscribe.ts"),
  route("api/inbound/resend", "routes/api.inbound.resend.ts"),
  route("api/push", "routes/api.push.ts"),
  route("api/cron/expire-cache", "routes/api.cron.expire-cache.ts"),
  route("api/cron/check-mail", "routes/api.cron.check-mail.ts"),
  route("api/dev/demo-data", "routes/api.dev.demo-data.ts"),
  route("review", "routes/review.tsx"),
  route("agents", "routes/agents.tsx"),
  route("api/auth/*", "routes/api.auth.ts"),
  route(".well-known/*", "routes/well-known.ts"),
  route("mcp", "routes/mcp.ts", { id: "mcp" }),
  route("mcp/*", "routes/mcp.ts", { id: "mcp-assets" }),
] satisfies RouteConfig;
