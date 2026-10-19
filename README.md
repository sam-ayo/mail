# mail

A keyboard-first email client with one inbox for all your accounts.

![The unified inbox with the reading pane](docs/screenshots/inbox.jpg)

![The command palette](docs/screenshots/command-palette.jpg)

![The light theme](docs/screenshots/light.jpg)

![The color themes in Settings](docs/screenshots/themes.jpg)

```sh
pnpm install
cp .env.example .env
pnpm dev
```

## Database migrations

Add each schema change as a new file in `migrations/`, with the next number. Apply the new files with:

```sh
DATABASE_URL=... pnpm migrate
```

The `schema_migrations` table records each file that ran. CI applies the files of a pull request to a copy of the production database. On `main`, CI applies them to production. Vercel can put the new code live before the migration runs, so a migration must not break the code that is in production now.

## AI agents (MCP)

`/mcp` is a remote MCP server for the mail in all accounts of a workspace. Add `${APP_URL}/mcp` as a custom connector in Claude, ChatGPT, or another MCP client. The client signs in with OAuth 2.1. The tools are `list_accounts`, `search_threads`, `get_thread`, `get_attachment`, `modify_threads`, and `send_message`.

- Better Auth (`@better-auth/mcp`) is the authorization server, under `/api/auth`. It supports Client ID Metadata Documents and Dynamic Client Registration. The config is in `app/server/agent-auth.server.ts`.
- A workspace has no password. The login step (`/oauth/login`) uses the mail session of the browser. The consent step is `/oauth/consent`.
- The scopes are `mail:read`, `mail:write`, and `mail:send`. `offline_access` gives a refresh token.
- Settings › AI agents lists the connected agents. Disconnect takes effect at once.
