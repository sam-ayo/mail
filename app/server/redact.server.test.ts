import { describe, expect, it } from "vitest";
import { redact } from "./redact.server";

describe("redact", () => {
  it("removes email addresses", () => {
    expect(redact("send_message to Ada <ada.lovelace+x@example.co.uk> failed")).toBe(
      "send_message to Ada <[email]> failed",
    );
  });

  it("removes strings that look like tokens", () => {
    expect(redact("token ya29a0AfB_byC3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 expired")).toBe("token [secret] expired");
  });

  it("keeps normal text and tool names", () => {
    const text = "search_threads returned 500 for folder sent with query after:2026/01/01";
    expect(redact(text)).toBe(text);
  });
});
