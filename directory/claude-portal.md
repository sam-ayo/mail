# Claude developer portal answers

## 1. Connection

- Server URL: `https://mail.samayo.me/mcp`
- Users connect to one URL.

## 2. Tools

The tools sync from the server. Each tool has a title and all three hints.

| Tool | Title | Read-only | Destructive | Open world |
| --- | --- | --- | --- | --- |
| `list_accounts` | List accounts | yes | no | no |
| `search_threads` | Search threads | yes | no | no |
| `get_thread` | Read thread | yes | no | no |
| `get_attachment` | Get attachment | yes | no | no |
| `compose_message` | Write email | yes | no | no |
| `modify_threads` | Change threads | no | yes | no |
| `send_message` | Send email | no | yes | yes |

`compose_message` sends nothing. Its view sends only when the user presses Send, through `send_message`, which Claude asks the user to allow.

## 3. Listing

- Server name: mail by samayo
- One-liner: Read, organize, and write the email in all your Gmail, Outlook, and hosted accounts, and edit and send email in the chat.
- Description:

  > mail by samayo connects Claude to the email in all the accounts of your mail by samayo workspace: Gmail, Outlook, Microsoft 365, and hosted addresses.
  >
  > Ask Claude to summarize your unread mail, find a conversation, read an attachment, or archive and star messages. When you ask for an email, Claude shows it in the chat: the sender, the recipients, the subject, and the body. Edit any field and press Send. Nothing goes out until you send it. For a new email, you choose the account that sends it.
  >
  > You sign in with your mail by samayo workspace and allow the permissions on a consent page: read, organize, and send. Disconnect Claude at any time in Settings › AI agents.

- Categories: Productivity, Communication
- Documentation URL: `https://mail.samayo.me/agents`
- Privacy policy URL: `https://mail.samayo.me/privacy`
- Support contact: mail@samayo.me
- Icon: `public/icon-512.png`
- Slug: `mail-by-samayo` (permanent after publication)

### Carousel screenshots

3–5 PNG images, at least 1000 px wide, cropped to the app response without the prompt. Make them in Claude with the reviewer workspace, so that they show only sample mail.

| Screenshot | Prompt |
| --- | --- |
| The reply to Maya in the compose view | Reply to Maya that Thursday works and that I'll take the inbox section. |
| A new email with the From menu open | Write an email from my Gmail to Sam that asks for the brand colours. |
| The view after Send ("Sent from …") | (The same reply, after Send.) |
| The compose view in the light theme | Write an email to Nora that confirms coffee on Wednesday at 9:30. |

## 4. Use cases

- Primary use cases: summarize and triage unread mail in several accounts; find and read conversations and attachments; write replies and new emails, edit them in the chat, and send them; archive, star, and delete mail.
- What users need: a mail by samayo workspace (free) with at least one connected email account.
- Data access: reads and writes.

## 5. Company

- Company: Samuel Adeoye (individual developer)
- Website: `https://mail.samayo.me`
- Primary contact: samuelayomideadeoye@gmail.com

## 6. Authentication

- Authentication requirement: required.
- Method: OAuth 2.1. The server is its own authorization server (`https://mail.samayo.me/api/auth`). It supports Client ID Metadata Documents and Dynamic Client Registration, so no client ID or secret is entered in the portal.

## 7. Data handling

- The API is our own: mail by samayo reads the user's mail from Google, Microsoft, or its own hosted mail server, with the user's permission.
- No personal health data. No sponsored content.

## 8. Test & launch

Use the steps under "Reviewer access" in `README.md`. Enter the review password in the credentials field. Confirm that each tool was run as a custom connector in Claude.

## 9. Compliance

Read and accept the seven acknowledgments. The connector does not do financial transactions or AI media generation, and it collects no conversation data.
