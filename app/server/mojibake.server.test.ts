import { describe, expect, it } from "vitest";
import { decodeText, repairMojibake } from "./mojibake.server";

describe("repairMojibake", () => {
  it("repairs quotes, dashes and accents", () => {
    expect(repairMojibake("click on â€œRegister as an Entrepreneurâ€\u009d now")).toBe(
      "click on “Register as an Entrepreneur” now",
    );
    expect(repairMojibake("Itâ€™s 9â€“5 â€” cafÃ© Â©")).toBe("It’s 9–5 — café ©");
    expect(repairMojibake("emoji ðŸ˜€")).toBe("emoji 😀");
  });

  it("repairs a closing quote without its last byte", () => {
    expect(repairMojibake("â€œRegister as an Entrepreneurâ€ ")).toBe("“Register as an Entrepreneur” ");
  });

  it("does not change correct text", () => {
    for (const text of ["café über naïve", "São Paulo", "“quoted” — 9–5", "Ãrvore", "plain"]) {
      expect(repairMojibake(text)).toBe(text);
    }
  });
});

describe("decodeText", () => {
  const encoder = new TextEncoder();

  it("reads UTF-8 bytes that say Windows-1252 as UTF-8", () => {
    expect(decodeText(encoder.encode("“hi” café"), "windows-1252")).toBe("“hi” café");
  });

  it("reads real Windows-1252 bytes with the declared charset", () => {
    expect(decodeText(Uint8Array.from([0x93, 0x68, 0x69, 0x94, 0x20, 0x63, 0x61, 0x66, 0xe9]), "windows-1252")).toBe(
      "“hi” café",
    );
  });

  it("uses UTF-8 for an unknown charset", () => {
    expect(decodeText(encoder.encode("ok"), "x-unknown")).toBe("ok");
  });
});
