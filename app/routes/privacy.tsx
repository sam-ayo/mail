import { CONTACT_EMAIL, LegalPage } from "~/components/legal";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => [{ title: "Privacy policy · mail by samayo" }];

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        mail by samayo is an email client at mail.samayo.me. It shows your Gmail, Outlook, and
        Microsoft 365 accounts in one inbox. This policy tells you which data mail by samayo uses, and how.
      </p>

      <h2>Data that mail by samayo uses</h2>
      <ul>
        <li>
          <strong>Your account profile:</strong> the email address and name of each account that you connect.
        </li>
        <li>
          <strong>OAuth tokens:</strong> the access and refresh tokens that Google or Microsoft give to mail by samayo when you
          sign in.
        </li>
        <li>
          <strong>Your email:</strong> messages, labels, folders, and attachments. mail by samayo reads them from Google or
          Microsoft when you open the app.
        </li>
      </ul>

      <h2>How mail by samayo uses your data</h2>
      <p>mail by samayo uses your data only to give you the features that you see in the app:</p>
      <ul>
        <li>Show your messages and threads.</li>
        <li>Search your mail.</li>
        <li>Send and reply to messages.</li>
        <li>Archive, delete, star, and mark messages as read or unread.</li>
        <li>Download attachments.</li>
      </ul>

      <h2>Storage</h2>
      <p>
        mail by samayo keeps your account profiles and your OAuth tokens in its database. It encrypts the tokens before it
        stores them.
      </p>
      <p>
        To show your message lists quickly, mail by samayo also keeps a cache of each conversation in the list: the subject,
        the senders and recipients, the date, and a short snippet of the text. mail by samayo encrypts this cache, and deletes
        each entry after 60 days. When you remove an account, mail by samayo deletes its cache at once.
      </p>
      <p>
        For Gmail and Outlook accounts, mail by samayo does not keep a copy of the full messages or of the attachments. It
        gets them from Google or Microsoft each time and sends them directly to your browser over HTTPS.
      </p>
      <p>
        For an address that mail by samayo hosts, mail by samayo is the mail server. It keeps the full messages and their attachments
        in its database until you delete them. Resend receives and sends this mail for mail by samayo.
      </p>
      <p>mail by samayo uses a session cookie to keep you signed in. The cookie expires after 90 days.</p>

      <h2>AI agents</h2>
      <p>
        You can connect an AI agent, such as Claude or ChatGPT, to your workspace through the MCP server at
        mail.samayo.me/mcp. The agent connects only after you sign in and allow it on a consent page. The consent page
        shows the permissions and the accounts.
      </p>
      <ul>
        <li>
          <strong>Permissions:</strong> read and search your mail; archive, delete, star, and mark mail as read; and send
          mail. The consent page shows the permissions that the agent asks for, before you allow it.
        </li>
        <li>
          <strong>Data that the agent gets:</strong> only the data of the tools that it calls, such as a list of
          conversations, the text of a conversation, or an attachment. mail by samayo sends this data to the agent's
          service, where the agent's provider keeps it under its own privacy policy.
        </li>
        <li>
          <strong>Data that mail by samayo keeps:</strong> the agent's name and address, your consent, and the access and
          refresh tokens. mail by samayo does not keep the conversations or the prompts of the agent.
        </li>
        <li>
          <strong>Retention:</strong> an access token expires after one hour, and a refresh token after 90 days.
        </li>
        <li>
          <strong>Your control:</strong> Settings › AI agents lists the agents that you allowed. Disconnect removes your
          consent and blocks the agent at once.
        </li>
      </ul>

      <h2>Sharing</h2>
      <p>
        mail by samayo does not sell your data, and does not use it for advertisements. mail by samayo shares your data only
        with an AI agent that you connect and allow, as the section above tells. People do not read your email, unless you
        give permission for a specific message, or the law requires it, or it is necessary for security.
      </p>

      <h2>Google user data</h2>
      <p>
        mail by samayo's use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        mail by samayo does not use Gmail data to train artificial intelligence (AI) or machine learning models.
      </p>

      <h2>Remove your data</h2>
      <p>
        To remove an account, open Settings and click Remove. mail by samayo then deletes the profile, the tokens, and the cache of
        that account. Your mail stays with Google or Microsoft. You can also revoke the access of mail by samayo at{" "}
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> or{" "}
        <a href="https://account.microsoft.com/privacy/app-access">account.microsoft.com/privacy/app-access</a>.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, this page will show the new policy and the date of the change.</p>

      <h2>Contact</h2>
      <p>
        If you have questions, send an email to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
