import { CONTACT_EMAIL, LegalPage } from "~/components/legal";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => [{ title: "Privacy policy · mail" }];

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        mail (also called Relay Mail) is an email client at mail.samayo.me. It shows your Gmail, Outlook, and
        Microsoft 365 accounts in one inbox. This policy tells you which data mail uses, and how.
      </p>

      <h2>Data that mail uses</h2>
      <ul>
        <li>
          <strong>Your account profile:</strong> the email address and name of each account that you connect.
        </li>
        <li>
          <strong>OAuth tokens:</strong> the access and refresh tokens that Google or Microsoft give to mail when you
          sign in.
        </li>
        <li>
          <strong>Your email:</strong> messages, labels, folders, and attachments. mail reads them from Google or
          Microsoft when you open the app.
        </li>
      </ul>

      <h2>How mail uses your data</h2>
      <p>mail uses your data only to give you the features that you see in the app:</p>
      <ul>
        <li>Show your messages and threads.</li>
        <li>Search your mail.</li>
        <li>Send and reply to messages.</li>
        <li>Archive, delete, star, and mark messages as read or unread.</li>
        <li>Download attachments.</li>
      </ul>

      <h2>Storage</h2>
      <p>
        mail keeps only your account profiles and your OAuth tokens in its database. It encrypts the tokens before
        it stores them. mail does not keep a copy of your messages or attachments. It gets them from Google or
        Microsoft each time and sends them directly to your browser over HTTPS.
      </p>
      <p>mail uses a session cookie to keep you signed in. The cookie expires after 90 days.</p>

      <h2>Sharing</h2>
      <p>
        mail does not sell your data. mail does not share your data with third parties, and does not use it for
        advertisements. People do not read your email, unless you give permission for a specific message, or the
        law requires it, or it is necessary for security.
      </p>

      <h2>Google user data</h2>
      <p>
        mail's use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        mail does not use Gmail data to train artificial intelligence (AI) or machine learning models.
      </p>

      <h2>Remove your data</h2>
      <p>
        To remove an account, open Settings and click Remove. mail then deletes the profile and the tokens of that
        account. Your mail stays with Google or Microsoft. You can also revoke the access of mail at{" "}
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
