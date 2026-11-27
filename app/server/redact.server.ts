// The repository of the feedback issues is public. This module does not import
// env.server.ts, so that the tests run without a database.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Long random strings, such as tokens and API keys.
const SECRET = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;

/** Removes email addresses and strings that look like tokens. */
export function redact(value: string) {
  return value.replace(EMAIL, "[email]").replace(SECRET, "[secret]");
}
