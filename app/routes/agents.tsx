import { LegalPage } from "~/components/legal";
import type { Route } from "./+types/agents";

// The public documentation of the MCP server. The Claude and ChatGPT directory
// listings link to this page. Keep the tool list the same as app/mcp/server.ts.

const SUPPORT_EMAIL = "mail@samayo.me";

export const meta: Route.MetaFunction = () => [
  { title: "AI agents · mail by samayo" },
  {
    name: "description",
    content: "Connect Claude, ChatGPT, or another MCP client to the email in all your mail by samayo accounts.",
  },
];

const TOOLS: [name: string, permission: string, description: string][] = [
  ["list_accounts", "Read", "Lists the accounts of the workspace, with the unread count of each inbox."],
  ["search_threads", "Read", "Lists or searches the conversations of a folder, in one account or in all accounts."],
  ["get_thread", "Read", "Reads all messages of a conversation as text, with the list of attachments."],
  ["get_attachment", "Read", "Gets one attachment of a message, up to 10 MB."],
  [
    "compose_message",
    "Read",
    "Writes an email and shows it in the chat, where you edit it and press Send. It sends nothing itself.",
  ],
  ["modify_threads", "Organize", "Archives, deletes, stars, or marks conversations as read or spam."],
  ["send_message", "Send", "Sends a new email, a reply, a reply to all, or a forward."],
];

export default function Agents() {
  return (
    <LegalPage title="Use mail by samayo with AI agents">
      <p>
        mail by samayo has a remote MCP server. It lets an AI agent, such as Claude or ChatGPT, read, organize, and write
        the email in all the accounts of your workspace: Gmail, Outlook, Microsoft 365, and hosted addresses.
      </p>

      <h2>Before you start</h2>
      <p>
        You need a mail by samayo workspace. Open <a href="https://mail.samayo.me">mail.samayo.me</a> and connect at least
        one email account.
      </p>

      <h2>Connect Claude</h2>
      <ul>
        <li>
          Open Settings › Connectors in Claude. Find mail by samayo in the directory, or click Add custom connector and
          enter <code>https://mail.samayo.me/mcp</code>.
        </li>
        <li>Click Connect. A browser window opens.</li>
        <li>
          Sign in to mail by samayo, if the browser is not signed in. Then read the consent page, and click Allow.
        </li>
      </ul>

      <h2>Connect ChatGPT</h2>
      <ul>
        <li>Open the apps of ChatGPT, and find mail by samayo.</li>
        <li>Click Connect, sign in to mail by samayo, and click Allow on the consent page.</li>
      </ul>

      <h2>Connect another MCP client</h2>
      <p>
        Add <code>https://mail.samayo.me/mcp</code> as a remote MCP server (Streamable HTTP). The client signs in with
        OAuth 2.1. The server supports Client ID Metadata Documents and Dynamic Client Registration.
      </p>

      <h2>Permissions</h2>
      <ul>
        <li>
          <strong>Read:</strong> read and search your email in all accounts.
        </li>
        <li>
          <strong>Organize:</strong> archive, delete, star, and mark your email as read.
        </li>
        <li>
          <strong>Send:</strong> send email from your accounts.
        </li>
      </ul>
      <p>
        The consent page shows the permissions and the accounts before you allow the agent. The agent gets only the data of
        the tools that it calls.
      </p>

      <h2>Tools</h2>
      <ul>
        {TOOLS.map(([name, permission, description]) => (
          <li key={name}>
            <code>{name}</code> ({permission}): {description}
          </li>
        ))}
      </ul>

      <h2>Write an email in the chat</h2>
      <p>
        When you ask the agent to write an email, it calls <code>compose_message</code>. The chat shows the email: the
        sender, the recipients, the subject, and the body. Edit any field, and press Send. For a new email, you can choose
        the account that sends it. A reply always comes from the account of its conversation. Clients that cannot show the
        view get the draft as text, and the agent asks you before it sends.
      </p>

      <h2>Examples</h2>
      <ul>
        <li>"Summarize the unread mail in my inboxes from today."</li>
        <li>"Find the email from Maya about the Q4 roadmap, and write a reply that says Thursday works."</li>
        <li>"Archive the newsletters in my work inbox from last week."</li>
        <li>"Write an email from my Gmail to Sam that asks for the brand colours."</li>
      </ul>

      <h2>Safety</h2>
      <p>
        Email comes from other people, and a message can contain instructions for an agent. Allow only agents that you
        trust, and keep the agent's approval settings on for actions that send or delete mail. Claude and ChatGPT ask you
        before they send or delete mail.
      </p>

      <h2>Disconnect an agent</h2>
      <p>
        Open Settings › AI agents in mail by samayo, and click Disconnect. The agent loses access at once. You can also
        remove the connector in Claude or ChatGPT.
      </p>

      <h2>Privacy</h2>
      <p>
        The <a href="/privacy">privacy policy</a> tells which data the agent gets and which data mail by samayo keeps.
      </p>

      <h2>Support</h2>
      <p>
        If you have a question or a problem, send an email to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
