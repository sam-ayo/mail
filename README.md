# mail

A keyboard-first email client with one inbox for all your accounts.

![The unified inbox with the reading pane](docs/screenshots/inbox.jpg)

![The command palette](docs/screenshots/command-palette.jpg)

![The light theme](docs/screenshots/light.jpg)

![The email accounts and the color themes in Settings](docs/screenshots/themes.jpg)

```sh
pnpm install
cp .env.example .env
pnpm dev
```

## AI agents (MCP)

`/mcp` is a remote MCP server for the mail in all accounts of a workspace. Add `${APP_URL}/mcp` as a custom connector in Claude, ChatGPT, or another MCP client. The client signs in with OAuth 2.1. The tools are `list_accounts`, `search_threads`, `get_thread`, `get_attachment`, `modify_threads`, `send_message`, and `compose_message`.

- The server uses [mcp-use](https://mcp-use.com). The tools are in `app/mcp/server.ts`. The `mcpUse()` Vite plugin runs that file in its own Vite environment, and `app/routes/mcp.ts` forwards `/mcp` and `/mcp/*` to it.
- `compose_message` is an MCP App. It sends nothing. The chat shows the email in the view `app/mcp/views/compose-message/view.tsx`, where the user edits it and presses Send. Send calls `send_message`. A client without MCP Apps gets the draft as text.
- `mcp-env.d.ts` gives the view the types of the tools. mcp-use makes it again when Vite starts.

- Better Auth (`@better-auth/mcp`) is the authorization server, under `/api/auth`. It supports Client ID Metadata Documents and Dynamic Client Registration. The config is in `app/server/agent-auth.server.ts`.
- A workspace has no password. The login step (`/oauth/login`) uses the mail session of the browser. The consent step is `/oauth/consent`.
- The scopes are `mail:read`, `mail:write`, and `mail:send`. `offline_access` gives a refresh token.
- Settings › AI agents lists the connected agents. Disconnect takes effect at once.
- `/agents` is the public documentation of the connector. The Claude and ChatGPT directory listings link to it.
- `/review` is the sign-in for directory reviewers. `REVIEW_PASSWORD` turns it on. Each sign-in gets a new workspace with three demo accounts, so reviewers never share a workspace. Demo accounts send nothing.
- `OPENAI_APPS_CHALLENGE` is the domain token for ChatGPT, at `/.well-known/openai-apps-challenge`.
