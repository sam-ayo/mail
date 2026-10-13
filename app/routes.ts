import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("auth/:provider", "routes/auth.start.tsx"),
  route("auth/:provider/callback", "routes/auth.callback.tsx"),
  route("connect/demo", "routes/connect.demo.tsx"),
  route("logout", "routes/logout.tsx"),

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
  route("api/dev/demo-data", "routes/api.dev.demo-data.ts"),

  // The iOS app. It signs in with a bearer token.
  route("api/mobile/token", "routes/api.mobile.token.ts"),
  route("api/mobile/link", "routes/api.mobile.link.ts"),
  route("api/mobile/logout", "routes/api.mobile.logout.ts"),
  route("api/mobile/demo", "routes/api.mobile.demo.ts"),
  route("api/v1/accounts", "routes/api.v1.accounts.ts"),
  route("api/v1/accounts/:accountId", "routes/api.v1.account.ts"),
  route("api/v1/threads", "routes/api.v1.threads.ts"),
  route("api/v1/threads/:accountId/:threadId", "routes/api.v1.thread.ts"),
] satisfies RouteConfig;
