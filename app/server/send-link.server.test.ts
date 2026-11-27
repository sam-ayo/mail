import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.server", () => ({ env: { appUrl: "https://mail.example.com", encryptionKey: "test-key" } }));

const { createSendLink, openSendLink } = await import("./send-link.server");

const input = { account_id: "a@b.com", mode: "new" as const, to: ["x@y.com"], body: "Hello" };
const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;

afterEach(() => {
  vi.useRealTimers();
});

describe("send links", () => {
  it("carries the email, encrypted", () => {
    const { url, nonce } = createSendLink("user-1", "client-1", input);
    expect(url.startsWith("https://mail.example.com/api/agent-send?t=")).toBe(true);
    expect(url).not.toContain("Hello");
    expect(openSendLink(tokenOf(url))).toMatchObject({ u: "user-1", c: "client-1", n: nonce, m: input });
  });

  it("gives each link its own random ID", () => {
    const a = createSendLink("user-1", "client-1", input);
    const b = createSendLink("user-1", "client-1", input);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.url).not.toBe(b.url);
  });

  it("expires after one hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
    const { url } = createSendLink("user-1", "client-1", input);
    vi.setSystemTime(new Date("2026-11-27T12:59:00Z"));
    expect(() => openSendLink(tokenOf(url))).not.toThrow();
    vi.setSystemTime(new Date("2026-11-27T13:00:01Z"));
    expect(() => openSendLink(tokenOf(url))).toThrow("expired");
  });

  it("refuses a changed or cut token", () => {
    const token = tokenOf(createSendLink("user-1", "client-1", input).url);
    const flipped = token.slice(0, 40) + (token[40] === "A" ? "B" : "A") + token.slice(41);
    expect(() => openSendLink(flipped)).toThrow("not valid");
    expect(() => openSendLink(token.slice(0, -5))).toThrow("not valid");
    expect(() => openSendLink("")).toThrow("not valid");
  });
});
