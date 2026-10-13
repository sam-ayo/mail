# mail

mail is a fast, keyboard-first email client. It shows many email accounts in one unified inbox.
It uses React Router v8 in framework mode, with server rendering, loaders, actions, and middleware.

## Features

- **Many accounts:** Gmail (Google OAuth), and Outlook and Microsoft 365 (Microsoft OAuth).
- **Unified inbox:** Each folder shows the mail from all accounts, sorted by date. You can also open one account at a time.
- **Duplicate merge:** If a conversation is in two or more accounts, the unified inbox shows it one time, with a dot for each account. An action on the row goes to all the copies.
- **Keyboard triage:** Use `j`/`k` to move, `e` to archive, `#` for Trash, `s` to star, `u` to mark unread, `x` to select, `r`/`a`/`f` to reply, reply all, or forward, `c` to compose, and `z` to undo. Press `?` to see all shortcuts.
- **Command palette:** Press `⌘K`.
- **Undo send:** A message waits 5 seconds before it goes, so you can stop it.
- **Optimistic updates:** An action shows at once, and the app reverts it if the server rejects it.
- **Safe HTML:** The server sanitizes email HTML. The reading pane shows it in a sandboxed iframe that cannot run scripts. The sanitizer removes tracking pixels.
- **Demo accounts:** Sample mail in memory, so you can try the app without OAuth. Each demo account that you add gets a different persona (work, personal, studio) with its own mail. Some messages go to more than one demo account, so the unified inbox shows how it merges duplicates.
- **Worst-case data (development only):** A "Demo data / Worst case" toggle in the bottom-left corner fills the demo inbox with long names, unbreakable emails, emoji, right-to-left text, and long file names. Use it to check layout changes.

## UI libraries

| Task | Library |
| --- | --- |
| Toasts | [Sonner](https://sonner.emilkowal.ski) |
| Command palette | [cmdk](https://cmdk.paco.me) |
| Dialog, drawer, tooltips | [Base UI](https://base-ui.com) |
| Long conversation lists | [react-virtuoso](https://virtuoso.dev) |
| Conditional class names | [clsx](https://github.com/lukeed/clsx) |

Motion rules: keyboard actions and the command palette never animate. Pressable controls use the `press` utility (`scale: 0.97`, 160 ms). The easing tokens `--ease-out`, `--ease-in-out`, and `--ease-drawer` are in `app/app.css`.

## Start the app

```sh
npm install
cp .env.example .env   # then set SESSION_SECRET and ENCRYPTION_KEY
npm run dev
```

Open http://localhost:5180, then click **Try a demo inbox**.

The app reads its settings from `.env`. Set `DATABASE_URL` to the Neon `dev` branch, not to production.

## Connect Gmail

1. Open the [Google Cloud console](https://console.cloud.google.com/), and create a project.
2. Turn on the **Gmail API**.
3. Configure the OAuth consent screen. Add the scope `https://www.googleapis.com/auth/gmail.modify`.
4. Create an OAuth client of the type **Web application**.
5. Add the redirect URI `${APP_URL}/auth/google/callback`.
6. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Note: `gmail.modify` is a restricted scope. For a public app, Google requires a security assessment. In testing mode, add your test users on the consent screen.

## Connect Outlook and Microsoft 365

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), register an app.
2. For "Supported account types", select personal Microsoft accounts and work or school accounts.
3. Add a **Web** redirect URI: `${APP_URL}/auth/microsoft/callback`.
4. Add the delegated Graph permissions `Mail.ReadWrite`, `Mail.Send`, `User.Read`, and `offline_access`.
5. Create a client secret.
6. Put the values in `.env` as `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.

## How it works

| Path | Purpose |
| --- | --- |
| `app/server/providers/` | One adapter for each provider (`gmail`, `outlook`, `imap`, `demo`). All adapters use the `MailProvider` interface in `types.ts`. |
| `app/server/mail.server.ts` | Merges the accounts into the unified view, and sanitizes messages for the reading pane. |
| `app/server/accounts.server.ts` | Account storage in Neon Postgres. The schema is in `migrations/`. Credentials use AES-256-GCM encryption. |
| `app/server/oauth/` | OAuth with PKCE, and token refresh. |
| `app/routes/app.tsx` | The signed-in layout. Its middleware sends signed-out visitors to `/welcome`. |
| `app/routes/mail.list.tsx` | The conversation list, search, infinite scroll, selection, and keyboard triage. |
| `app/routes/mail.thread.tsx` | The reading pane and inline replies. |
| `app/components/mail-context.tsx` | Optimistic actions, undo, the send queue, and unread counts. |

A browser session belongs to a workspace. If you sign in to a mailbox on a new browser, you get the workspace that the mailbox belongs to.

## Known limits

- The app gets mail from the providers on each request. It has no local sync database yet. The Gmail adapter caches thread summaries by `historyId`.
- IMAP shows each message as its own conversation.
- New mail shows after a one-minute poll. The app does not use push notifications yet.
- The demo account resets when the server restarts.

## Production

The app runs on Vercel at https://mail.samayo.me. The database is the Neon project `relay-mail` (production branch `main`, development branch `dev`).

```sh
npx vercel deploy --prod
```

Vercel keeps the production environment variables. `.env.production` holds a local copy, and git ignores it. Keep a backup of `ENCRYPTION_KEY`. If you lose it, the app cannot read the stored account credentials.

To change the schema, add a SQL file to `migrations/` and run it on both Neon branches.

`vite.config.ts` bundles all server dependencies (`ssr.noExternal`). sanitize-html loads the ES module htmlparser2 with `require()`, and the Vercel runtime rejects that.

The `Dockerfile` needs a `DATABASE_URL` and the other variables at run time.
