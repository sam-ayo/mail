import { Link } from "react-router";
import { CONTACT_EMAIL, LegalPage } from "~/components/legal";
import type { Route } from "./+types/terms";

export const meta: Route.MetaFunction = () => [{ title: "Terms of service · mail" }];

export default function Terms() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms apply when you use mail (also called Relay Mail) at mail.samayo.me. When you use mail, you agree
        to these terms.
      </p>

      <h2>The service</h2>
      <p>
        mail is an email client. It connects to your Gmail, Outlook, or Microsoft 365 account with OAuth, and shows
        your mail in one inbox. Your mail stays with Google or Microsoft.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Connect only email accounts that you own or that you have permission to use.</li>
        <li>Do not use mail to send spam, or for illegal activity.</li>
        <li>Obey the terms of Google and Microsoft for your email accounts.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        You own your data. The <Link to="/privacy">privacy policy</Link> tells you how mail uses it.
      </p>

      <h2>No warranty</h2>
      <p>
        mail is free and comes "as is", without a warranty of any kind. mail is not responsible for lost mail, lost
        data, or a stop in the service. To the maximum extent that the law permits, mail is not liable for damages
        that come from your use of the service.
      </p>

      <h2>End of use</h2>
      <p>
        You can stop the use of mail at any time. To do this, remove your accounts in Settings. mail can stop or
        change the service at any time.
      </p>

      <h2>Changes</h2>
      <p>If these terms change, this page will show the new terms and the date of the change.</p>

      <h2>Contact</h2>
      <p>
        If you have questions, send an email to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
