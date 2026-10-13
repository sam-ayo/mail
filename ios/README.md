# Relay for iOS

A native SwiftUI client for the mail server in this repo. It needs iOS 26 or later.

The app does not talk to Gmail or Outlook directly. It calls the Relay server,
which keeps the OAuth tokens and the provider code. The app signs in with a
bearer token.

## Run it

1. Apply `migrations/0003_mobile_sessions.sql` to the database of the server.
2. Start the server with `pnpm dev`.
3. Open `ios/Relay.xcodeproj` in Xcode and run the `Relay` scheme.

A Debug build uses `http://localhost:5180`. A Release build uses
`https://mail.samayo.me`. The `RELAY_SERVER_URL` build setting holds these values.
A Debug build also shows a server field and a demo inbox button on the sign-in screen.

## Sign-in

1. The app opens `/auth/<provider>?client=ios&challenge=<S256>` in a browser sheet
   (`ASWebAuthenticationSession`).
2. After the provider sign-in, the server goes to `relaymail://auth?code=<code>`.
3. The app sends the code and its PKCE verifier to `POST /api/mobile/token`.
   The server returns a token. The app keeps the token in the keychain.

To add a second account, the app first gets a link ticket from `POST /api/mobile/link`.
The ticket connects the new account to the same user.

The OAuth redirect URIs do not change. Google and Microsoft still return to
`/auth/<provider>/callback` on the server.

## API

The app uses these routes. Each one accepts `Authorization: Bearer <token>`.

| Route | Use |
| --- | --- |
| `GET /api/v1/accounts` | The accounts |
| `PATCH`, `DELETE /api/v1/accounts/:accountId` | Rename, recolor, or remove an account |
| `GET /api/v1/threads?scope=&folder=&q=&cursor=` | A page of conversations |
| `GET /api/v1/threads/:accountId/:threadId` | One conversation |
| `GET /api/counts` | Inbox unread counts |
| `POST /api/threads` | Archive, trash, star, and other actions |
| `POST /api/send` | Send. The app sends a `markdown` body |
| `GET /api/attachments/:accountId` | An attachment |
| `GET /api/avatar` | A sender photo or company logo |
| `POST /api/unsubscribe` | Leave a mailing list |
| `POST /api/mobile/logout` | Delete the token on the server |

## UI tests

`RelayUITests` signs in with a demo account. It needs a Debug server.
Set `RELAY_SERVER_URL` in the test environment if the server is not on `localhost:5180`.
