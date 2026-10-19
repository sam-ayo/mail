// OAuth scopes for AI agents (MCP clients). The server and the browser share them.

export const MAIL_SCOPES = {
  "mail:read": "Read and search your email in all accounts",
  "mail:write": "Archive, delete, star, and mark your email as read",
  "mail:send": "Send email from your accounts",
} as const;

export type MailScope = keyof typeof MAIL_SCOPES;

export function isMailScope(scope: string): scope is MailScope {
  return scope in MAIL_SCOPES;
}
