import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../oauth/tokens.server", () => ({
  createTokenSource: () => ({ get: async () => "token", refresh: async () => {} }),
}));
vi.mock("../accounts.server", () => ({ setAccountStatus: vi.fn() }));

const { createOutlookProvider } = await import("./outlook.server");

const provider = createOutlookProvider({ id: "acc-1", email: "me@example.com" } as never);

/** A fake Graph API: each message ID is a draft or not, and the test sees each call. */
function graph(messages: Record<string, { isDraft: boolean }>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push(`${method} ${url.replace("https://graph.microsoft.com/v1.0/me", "")}`);
      const id = decodeURIComponent(url.split("/messages/")[1].split("?")[0]);
      const message = messages[id];
      if (!message) return Response.json({ error: { message: "Not found" } }, { status: 404 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(message);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Outlook deleteDraft", () => {
  it("deletes a draft", async () => {
    const calls = graph({ d1: { isDraft: true } });
    await provider.deleteDraft!("d1");
    expect(calls).toEqual(["GET /messages/d1?$select=isDraft", "DELETE /messages/d1"]);
  });

  it("does not delete a message that is not a draft", async () => {
    const calls = graph({ m1: { isDraft: false } });
    await expect(provider.deleteDraft!("m1")).rejects.toThrow("The message is not a draft");
    expect(calls).toEqual(["GET /messages/m1?$select=isDraft"]);
  });

  it("does nothing for a draft that does not exist", async () => {
    const calls = graph({});
    await expect(provider.deleteDraft!("gone")).resolves.toBeUndefined();
    expect(calls).toEqual(["GET /messages/gone?$select=isDraft"]);
  });
});

describe("Outlook saveDraft", () => {
  it("does not change a message that is not a draft", async () => {
    const calls = graph({ m1: { isDraft: false } });
    const message = { to: [], cc: [], bcc: [], subject: "x", html: "x", text: "x", attachments: [] };
    await expect(provider.saveDraft!(message, "m1")).rejects.toThrow("The message is not a draft");
    expect(calls).toEqual(["GET /messages/m1?$select=isDraft"]);
  });

  it("changes a draft", async () => {
    const calls = graph({ d1: { isDraft: true } });
    const message = { to: [], cc: [], bcc: [], subject: "x", html: "x", text: "x", attachments: [] };
    await expect(provider.saveDraft!(message, "d1")).resolves.toEqual({ draftId: "d1" });
    expect(calls).toEqual(["GET /messages/d1?$select=isDraft", "PATCH /messages/d1"]);
  });
});
