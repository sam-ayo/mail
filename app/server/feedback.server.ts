import { env } from "./env.server";
import { redact } from "./redact.server";

/**
 * Feedback from AI agents about the MCP server. Each report becomes an issue
 * in the GitHub repository. The repository is public, so the text of a report
 * loses all email addresses before it goes to GitHub.
 */

export const FEEDBACK_KINDS = ["blocked", "bug", "missing_feature", "confusing", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface AgentFeedback {
  kind: FeedbackKind;
  summary: string;
  details: string;
  tool?: string;
  /** The name of the agent, from its OAuth client. */
  agent?: string | null;
}

export const feedbackConfigured = () => !!env.feedback.githubToken;

/** Opens a GitHub issue for the feedback. Returns the URL of the issue. */
export async function fileFeedback(feedback: AgentFeedback) {
  if (!feedbackConfigured()) throw new Error("Feedback is not available on this server.");
  const title = `[agent feedback] ${redact(feedback.summary).replace(/\s+/g, " ").trim().slice(0, 120)}`;
  const body = [
    `**Kind:** ${feedback.kind}`,
    feedback.tool ? `**Tool:** \`${redact(feedback.tool).replace(/`/g, "")}\`` : null,
    feedback.agent ? `**Agent:** ${redact(feedback.agent)}` : null,
    "",
    redact(feedback.details).slice(0, 8000),
    "",
    "---",
    "An AI agent sent this report with the `send_feedback` tool of the MCP server.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const response = await fetch(`https://api.github.com/repos/${env.feedback.githubRepo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.feedback.githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "mail-mcp-feedback",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, labels: ["agent-feedback", `feedback:${feedback.kind}`] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error("GitHub feedback issue failed", response.status, await response.text().catch(() => ""));
    throw new Error("The feedback could not be saved. Try again later.");
  }
  const issue = (await response.json()) as { html_url: string };
  return issue.html_url;
}
