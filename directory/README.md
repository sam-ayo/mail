# Directory submissions

This folder has what the Claude Connectors Directory and the ChatGPT directory ask for. The MCP server is `https://mail.samayo.me/mcp`. The public documentation is `https://mail.samayo.me/agents`.

- `claude-portal.md`: the answers for each step of the Claude developer portal.
- `chatgpt/`: the plugin package for ChatGPT. Make the ZIP with `cd directory/chatgpt && zip -r ../mail-by-samayo-chatgpt.zip .`.

Do not put the review password in this folder. Enter it only in the portals.

## Before you submit

1. Set `REVIEW_PASSWORD` in the Vercel production environment, as a Sensitive variable. Use a long random value: `openssl rand -base64 24`. Then redeploy.
2. Open `https://mail.samayo.me/review` and sign in with the password. Check that the workspace has three demo accounts.
3. Make the screenshots (see `claude-portal.md`).

## Claude

Requirements: [Submit a connector](https://claude.com/docs/connectors/building/submission), [Review criteria](https://claude.com/docs/connectors/building/review-criteria).

1. Open [claude.ai/directory/manage](https://claude.ai/directory/manage) with a paid Claude plan. Select **Submit new**, then **MCP connector**.
2. Fill in each step with the answers in `claude-portal.md`.

## ChatGPT

Requirements: [Submit plugins](https://developers.openai.com/plugins/deploy/submission), [Plugin guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines).

1. Verify your developer identity in the OpenAI platform organization settings.
2. Start a plugin submission **With MCP**, and upload the ZIP.
3. The portal gives a domain token. Set `OPENAI_APPS_CHALLENGE` to it in Vercel and redeploy. `https://mail.samayo.me/.well-known/openai-apps-challenge` must then return the token alone.
4. Connect the server and sign in with the review password. The scan reads the tools.
5. Record a video of the five positive test cases in `chatgpt/plugin.json`, and put its URL in the **demo recording** field.
6. In **Review details**, enter the reviewer steps from "Reviewer access" below.

## Reviewer access

The same steps work for both directories.

1. Add the connector, and click Connect. A browser window opens at the mail by samayo sign-in page.
2. Click **Sign in with the review password**, and enter the review password.
3. On the consent page, click **Allow**.

The reviewer gets a new workspace with three accounts of sample mail: a custom domain (alex@northwind.io), a Gmail-style account, and an Outlook-style account. Each sign-in gets its own workspace. These demo accounts send nothing: a sent email only goes to the Sent folder. There is no MFA and no email code.
