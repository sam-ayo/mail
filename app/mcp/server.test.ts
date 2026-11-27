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
vi.mock("~/server/triage.server", () => ({
  setCategories: vi.fn(async (_user: string, items: unknown[]) => items.length),
  withCategories: vi.fn(async (threads: unknown[]) => threads),
}));
vi.mock("~/server/contacts.server", () => ({
  listContacts: vi.fn(async () => []),
  findContacts: vi.fn(async () => []),
}));
vi.mock("~/server/remote-file.server", () => ({ downloadFile: vi.fn() }));
vi.mock("~/server/agent-uploads.server", () => ({
  createUpload: vi.fn(async () => ({
    id: "up-1",
    url: "http://localhost:5180/api/agent-uploads/up-1?token=secret",
    expiresAt: new Date("2026-11-27T13:00:00Z"),
  })),
  getUpload: vi.fn(async () => ({ filename: "signed.pdf", contentType: "", content: Buffer.from("%PDF-signed") })),
  storeFile: vi.fn(async () => "up-stored"),
}));
vi.mock("~/server/mail.server", () => ({
  deleteDraft: vi.fn(async () => {}),
  saveDraft: vi.fn(async () => ({ draftId: "draft-2" })),
  unsubscribe: vi.fn(async () => ({ method: "oneClick" })),
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
const triage = vi.mocked(await import("~/server/triage.server"));
const contacts = vi.mocked(await import("~/server/contacts.server"));
const remote = vi.mocked(await import("~/server/remote-file.server"));
const uploads = vi.mocked(await import("~/server/agent-uploads.server"));
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

const message = (id: string, from: string, extra: Record<string, unknown> = {}) => ({
  id,
  threadId: "t1",
  from: { email: from },
  to: [{ email: "me@example.com" }],
  cc: [],
  bcc: [],
  replyTo: [],
  subject: "Hello",
  date: "2026-11-01T10:00:00Z",
  snippet: "",
  text: `Body of ${id}`,
  unread: false,
  starred: false,
  attachments: [],
  ...extra,
});

describe("addresses", () => {
  it("refuses a name that is not an address and names find_contacts", async () => {
    const result = await callTool("send_message", { ...base, to: ["Ada Lovelace"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("find_contacts");
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });
});

describe("url attachments", () => {
  it("downloads the file and uses the extension when the server sends octet-stream", async () => {
    remote.downloadFile.mockResolvedValue({
      filename: "q3.pdf",
      contentType: "application/octet-stream",
      content: Buffer.from("%PDF"),
    });
    const result = await callTool("send_message", { ...base, attachments: [{ url: "https://files.example.com/q3.pdf" }] });
    expect(result.isError).toBeFalsy();
    expect(remote.downloadFile).toHaveBeenCalledWith("https://files.example.com/q3.pdf", 25 * 1024 * 1024);
    expect(mail.sendMessage.mock.calls[0][2].attachments).toEqual([
      { filename: "q3.pdf", contentType: "application/pdf", content: Buffer.from("%PDF") },
    ]);
  });

  it("refuses an attachment with two sources", async () => {
    const result = await callTool("send_message", {
      ...base,
      attachments: [{ filename: "a.txt", text: "x", url: "https://files.example.com/a.txt" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only one of");
    expect(remote.downloadFile).not.toHaveBeenCalled();
  });
});

describe("find_contacts", () => {
  it("finds people for a query and gives each as an address", async () => {
    contacts.findContacts.mockResolvedValue([{ email: "ada@acme.com", name: "Ada Lovelace", count: 3 }]);
    const result = await callTool("find_contacts", { query: " ada lovelace " });
    expect(contacts.findContacts).toHaveBeenCalledWith("user-1", "ada lovelace");
    expect(JSON.parse(result.content[0].text).contacts).toEqual([
      { name: "Ada Lovelace", email: "ada@acme.com", address: "Ada Lovelace <ada@acme.com>", conversations: 3 },
    ]);
  });

  it("lists the people the user writes to most with no query, up to the limit", async () => {
    contacts.listContacts.mockResolvedValue([
      { email: "a@x.com", count: 3 },
      { email: "b@x.com", count: 2 },
      { email: "c@x.com", count: 1 },
    ]);
    const result = await callTool("find_contacts", { limit: 2 });
    expect(contacts.listContacts).toHaveBeenCalledWith("user-1");
    expect(JSON.parse(result.content[0].text).contacts.map((c: { email: string }) => c.email)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("tells the agent not to guess when nobody matches", async () => {
    contacts.findContacts.mockResolvedValueOnce([]);
    const result = await callTool("find_contacts", { query: "zed" });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ contacts: [], note: expect.stringContaining("Do not guess") });
  });
});

describe("drafts", () => {
  it("saves a new draft with no files and gives the draft_id", async () => {
    const result = await callTool("save_draft", base);
    expect(result.content[0].text).toContain("draft_id: draft-2");
    const [user, accountId, outgoing, draftId] = mail.saveDraft.mock.calls[0];
    expect([user, accountId, draftId]).toEqual(["user-1", "acc-1", undefined]);
    expect(outgoing).toMatchObject({ subject: "Files", attachments: [], to: [{ email: "ada@example.com" }] });
  });

  it("changes a draft with its draft_id", async () => {
    await callTool("save_draft", { ...base, draft_id: "draft-1" });
    expect(mail.saveDraft.mock.calls[0][3]).toBe("draft-1");
  });

  it("deletes a draft", async () => {
    const result = await callTool("delete_draft", { account_id: "acc-1", draft_id: "draft-1" });
    expect(result.isError).toBeFalsy();
    expect(mail.deleteDraft).toHaveBeenCalledWith("user-1", "acc-1", "draft-1");
  });
});

describe("set_category", () => {
  it("saves the category with the sender that is not the user", async () => {
    mail.providerFor.mockReturnValue({
      getThread: vi.fn(async (id: string) => {
        if (id === "missing") throw new Error("Thread not found");
        return { id, subject: "Hi", messages: [message("m1", "news@shop.com"), message("m2", "me@example.com")] };
      }),
    } as never);
    const result = await callTool("set_category", {
      account_id: "acc-1",
      thread_ids: ["t1", "missing"],
      category: "promotion",
    });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { thread_id: "t1", ok: true, category: "promotion" },
      { thread_id: "missing", ok: false, error: "Thread not found" },
    ]);
    expect(triage.setCategories).toHaveBeenCalledWith(
      "user-1",
      [{ accountId: "acc-1", threadId: "t1", category: "promotion", sender: "news@shop.com" }],
      "user",
    );
  });
});

describe("unsubscribe", () => {
  it("uses the newest message with unsubscribe data", async () => {
    const list = { url: "https://shop.com/u", oneClick: true };
    mail.providerFor.mockReturnValue({
      getThread: vi.fn(async () => ({
        id: "t1",
        subject: "Sale",
        messages: [message("m1", "news@shop.com", { unsubscribe: list }), message("m2", "news@shop.com", { unsubscribe: list }), message("m3", "me@example.com")],
      })),
    } as never);
    const result = await callTool("unsubscribe", { account_id: "acc-1", thread_id: "t1" });
    expect(mail.unsubscribe).toHaveBeenCalledWith("user-1", "acc-1", "t1", "m2");
    expect(result.content[0].text).toContain("one-click");
  });

  it("gives the website URL to the user", async () => {
    mail.unsubscribe.mockResolvedValueOnce({ method: "website", url: "https://shop.com/prefs" });
    const result = await callTool("unsubscribe", { account_id: "acc-1", thread_id: "t1", message_id: "m1" });
    expect(result.content[0].text).toContain("https://shop.com/prefs");
  });
});

describe("get_threads", () => {
  it("reads several threads and keeps going after an error", async () => {
    mail.providerFor.mockReturnValue({
      getThread: vi.fn(async (id: string) => {
        if (id === "bad") throw new Error("Thread not found");
        return { id, subject: `Subject ${id}`, messages: [message(`m-${id}`, "a@b.com", { text: "x".repeat(5000) })] };
      }),
    } as never);
    const result = await callTool("get_threads", {
      threads: [
        { account_id: "acc-1", thread_id: "t1" },
        { account_id: "me@example.com", thread_id: "bad" },
        { account_id: "nobody@example.com", thread_id: "t2" },
      ],
    });
    const out = result.content[0].text;
    expect(out).toContain("Subject t1");
    expect(out).toContain("The tool cut it at 4000 characters");
    expect(out).toContain("thread_id: bad\nError: Thread not found");
    expect(out).toContain("The workspace has no account nobody@example.com");
  });
});

describe("uploads", () => {
  it("create_upload gives the URL, the ID, and the curl command, and keeps only the base name", async () => {
    const result = await callTool("create_upload", { filename: "../../Documents/signed.pdf" });
    const out = JSON.parse(result.content[0].text);
    expect(uploads.createUpload).toHaveBeenCalledWith("user-1", "signed.pdf", undefined);
    expect(out).toMatchObject({ upload_id: "up-1", upload_url: expect.stringContaining("token=secret") });
    expect(out.command).toBe('curl -sS -T <path to signed.pdf> "http://localhost:5180/api/agent-uploads/up-1?token=secret"');
  });

  it("attaches an upload by its ID, with the type from the extension", async () => {
    const result = await callTool("send_message", { ...base, attachments: [{ upload_id: "up-1" }] });
    expect(result.isError).toBeFalsy();
    expect(uploads.getUpload).toHaveBeenCalledWith("user-1", "up-1");
    expect(mail.sendMessage.mock.calls[0][2].attachments).toEqual([
      { filename: "signed.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-signed") },
    ]);
  });
});

describe("review fixes", () => {
  it("reply_all leaves out a copied address with no domain, and keeps the others", async () => {
    mail.loadThread.mockResolvedValue({
      id: "t1",
      subject: "Plan",
      messages: [
        message("m1", "ada@acme.com", {
          to: [{ email: "me@example.com" }, { email: "bob@acme.com" }],
          cc: [{ name: "Team", email: "team" }],
        }),
      ],
    } as never);
    const result = await callTool("send_message", { account_id: "acc-1", mode: "reply_all", thread_id: "t1", body: "OK" });
    expect(result.isError).toBeFalsy();
    const sent = mail.sendMessage.mock.calls[0][2];
    expect(sent.to.map((a) => a.email)).toEqual(["ada@acme.com"]);
    expect(sent.cc.map((a) => a.email)).toEqual(["bob@acme.com"]);
  });

  it("compose_message gives the view an upload for a URL file, so Send does not download it again", async () => {
    remote.downloadFile.mockResolvedValue({ filename: "q3.pdf", contentType: "application/pdf", content: Buffer.from("%PDF") });
    const inline = { filename: "a.txt", text: "x" };
    const result = await callTool("compose_message", {
      ...base,
      attachments: [inline, { url: "https://files.example.com/q3.pdf" }],
    });
    expect(uploads.storeFile).toHaveBeenCalledWith("user-1", {
      filename: "q3.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF"),
    });
    expect(result._meta?.attachments).toEqual([inline, { upload_id: "up-stored", filename: "q3.pdf" }]);
  });

  it("refuses a mime_type that is not a MIME type", async () => {
    const result = await callTool("send_message", {
      ...base,
      attachments: [{ filename: "a.pdf", text: "x", mime_type: "pdf please" }],
    });
    expect(result.isError).toBe(true);
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });
});
