import { describe, expect, it } from "vitest";
import { decodeBase64, inlineAttachment, mimeTypeOf } from "./attachments";

describe("mimeTypeOf", () => {
  it("finds the type from the extension", () => {
    expect(mimeTypeOf("Report.PDF")).toBe("application/pdf");
    expect(mimeTypeOf("sheet.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("uses the fallback for an unknown extension", () => {
    expect(mimeTypeOf("archive.xyz")).toBe("application/octet-stream");
    expect(mimeTypeOf("notes", "text/plain")).toBe("text/plain");
  });
});

describe("decodeBase64", () => {
  it("decodes base64 with line breaks", () => {
    expect(decodeBase64("aGVs\nbG8=").data.toString()).toBe("hello");
  });

  it("removes a data URL prefix and keeps its type", () => {
    const result = decodeBase64("data:image/png;base64,aGVsbG8=");
    expect(result.data.toString()).toBe("hello");
    expect(result.mimeType).toBe("image/png");
  });

  it("rejects content that is not base64", () => {
    expect(() => decodeBase64("not base64!")).toThrow("not valid base64");
  });
});

describe("inlineAttachment", () => {
  it("makes a file from base64 content", () => {
    const file = inlineAttachment({ filename: "a.pdf", content_base64: Buffer.from("%PDF").toString("base64") });
    expect(file).toEqual({ filename: "a.pdf", contentType: "application/pdf", content: Buffer.from("%PDF") });
  });

  it("makes a file from text", () => {
    const file = inlineAttachment({ filename: "rows.csv", text: "a,b\n1,2" });
    expect(file.contentType).toBe("text/csv");
    expect(file.content.toString()).toBe("a,b\n1,2");
  });

  it("uses the given MIME type", () => {
    expect(inlineAttachment({ filename: "x", text: "x", mime_type: "text/x-custom" }).contentType).toBe(
      "text/x-custom",
    );
  });

  it("needs a filename and content", () => {
    expect(() => inlineAttachment({ text: "x" })).toThrow("needs a filename");
    expect(() => inlineAttachment({ filename: "a.txt" })).toThrow("Give content_base64, text, upload_id, url");
  });
});
