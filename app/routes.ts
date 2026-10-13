import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("welcome", "routes/welcome.tsx"),
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
  route("api/unsubscribe", "routes/api.unsubscribe.ts"),
  route("api/dev/demo-data", "routes/api.dev.demo-data.ts"),
] satisfies RouteConfig;
