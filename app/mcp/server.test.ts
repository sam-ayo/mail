import { beforeEach, describe, expect, it, vi } from "vitest";

// The test calls the tools through the HTTP handler of the MCP server. The mail
// functions and the token check are mocks.

vi.mock("~/server/env.server", () => ({ env: { appUrl: "http://localhost:5180", isProduction: true } }));
vi.mock("~/server/image-proxy.server", () => ({ proxiedImageUrl: (url: string) => url }));
vi.mock("~/server/rate-limit.server", () => ({ rateLimit: vi.fn(async () => true) }));
vi.mock("~/server/feedback.server", () => ({
  FEEDBACK_KINDS: ["bug"],
  feedbackConfigured: () => false,
  fileFeedback: vi.fn(),
}));
vi.mock("~/server/agent-connections.server", () => ({
  hasConsent: vi.fn(async () => true),
  MCP_RESOURCE: "http://localhost:5180/mcp",
}));
vi.mock("~/server/accounts.server", () => ({
  listAccounts: vi.fn(async () => [account]),
  resolveUser: vi.fn(async (id: string) => id),
  toSummary: vi.fn((a: unknown) => a),
}));
vi.mock("~/server/mail.server", () => ({
  forwardedAttachments: vi.fn(async () => []),
  getAttachment: vi.fn(),
  listThreads: vi.fn(),
  loadThread: vi.fn(),
  modifyThread: vi.fn(),
  providerFor: vi.fn(),
  requireAccount: vi.fn(async () => account),
  sendMessage: vi.fn(async () => {}),
  unreadCounts: vi.fn(async () => ({})),
}));
vi.mock("mcp-use/oauth/better-auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("mcp-use/oauth/better-auth")>();
  return {
    ...original,
    oauthBetterAuthProvider: (options: Parameters<typeof original.oauthBetterAuthProvider>[0]) => ({
      ...original.oauthBetterAuthProvider(options),
      createTokenVerifier: () => ({
        verifyAccessToken: async (token: string) => ({
          token,
          clientId: "client-1",
          scopes: ["mail:read", "mail:write", "mail:send"],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          resource: new URL("http://localhost:5180/mcp"),
          extra: { payload: { sub: "user-1", azp: "client-1", scope: "mail:read mail:write mail:send" } },
        }),
      }),
    }),
  };
});

const account = { id: "acc-1", email: "me@example.com", name: "Me", provider: "imap", status: "active" };
const mail = vi.mocked(await import("~/server/mail.server"));
const { default: server } = await import("./server");
// The build primes the real view bundle. The test needs only a placeholder.
server.__primeViews({ "compose-message": { kind: "inline", js: "", css: "" } });

async function callTool(name: string, args: Record<string, unknown>) {
  const response = await server.fetch(
    new Request("http://localhost:5180/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const raw = await response.text();
  const body = raw.startsWith("{") ? raw : raw.split("\n").find((line) => line.startsWith("data:"))!.slice(5);
  const parsed = JSON.parse(body);
  if (parsed.error) throw new Error(`${response.status} ${JSON.stringify(parsed.error)}`);
  return parsed.result as {
    content: { type: string; text: string }[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
}

const base = { account_id: "acc-1", to: ["ada@example.com"], subject: "Files", body: "Here are the files." };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("send_message attachments", () => {
  it("sends base64, text, and files of other emails", async () => {
    mail.getAttachment.mockResolvedValue({
      filename: "contract.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-contract"),
    } as never);
    const result = await callTool("send_message", {
      ...base,
      attachments: [
        { filename: "photo.png", content_base64: Buffer.from("png-bytes").toString("base64") },
        { filename: "rows.csv", text: "a,b\n1,2" },
        { message_id: "msg-9", attachment_id: "att-3" },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("with 3 attachments");
    expect(mail.getAttachment).toHaveBeenCalledWith("user-1", "acc-1", "msg-9", "att-3");
    const sent = mail.sendMessage.mock.calls[0][2];
    expect(sent.attachments).toEqual([
      { filename: "photo.png", contentType: "image/png", content: Buffer.from("png-bytes") },
      { filename: "rows.csv", contentType: "text/csv", content: Buffer.from("a,b\n1,2") },
      { filename: "contract.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-contract") },
    ]);
  });

  it("does not send when an attachment is not valid", async () => {
    const result = await callTool("send_message", {
      ...base,
      attachments: [{ filename: "a.pdf", content_base64: "not base64!" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not valid base64");
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });

  it("does not send more than 25 MB", async () => {
    const big = Buffer.alloc(26 * 1024 * 1024).toString("base64");
    const result = await callTool("send_message", {
      ...base,
      attachments: [{ filename: "big.bin", content_base64: big }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("25 MB");
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });
});

describe("compose_message attachments", () => {
  it("lists the files and gives their input to the view only", async () => {
    const attachments = [{ filename: "notes.md", text: "# Notes" }];
    const result = await callTool("compose_message", { ...base, attachments });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.attachments).toEqual([
      { filename: "notes.md", mime_type: "text/markdown", size: 7, source: "added" },
    ]);
    expect(result._meta?.attachments).toEqual(attachments);
    expect(result.content[0].text).toContain("Attachment: notes.md (text/markdown, 7 bytes)");
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });
});
