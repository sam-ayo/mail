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
