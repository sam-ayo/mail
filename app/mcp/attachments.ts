import * as z from "zod";

/**
 * The files that an agent attaches to an email. The agent gives each file as
 * base64 content, as text, or as a file of another email in the workspace.
 */

/** The limit of all files of one email, the same as in the mail app. */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export const attachmentInput = z.object({
  filename: z
    .string()
    .optional()
    .describe("The file name with its extension, for example report.pdf. Required with content_base64 or text."),
  mime_type: z
    .string()
    .optional()
    .describe("For example application/pdf. The default comes from the extension of the file name."),
  content_base64: z.string().optional().describe("The content of the file, base64-encoded."),
  text: z
    .string()
    .optional()
    .describe("The content of a text file, for example CSV or Markdown. Use it in place of content_base64."),
  message_id: z
    .string()
    .optional()
    .describe("To attach a file of another email: the message_id from get_thread."),
  attachment_id: z.string().optional().describe("With message_id: the attachment_id from get_thread."),
  account_id: z
    .string()
    .optional()
    .describe("With message_id: the account of that email. The default is the account that sends."),
});

export type AttachmentInput = z.infer<typeof attachmentInput>;

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  ics: "text/calendar",
  vcf: "text/vcard",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  key: "application/vnd.apple.keynote",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
};

/** The MIME type of a file name, from its extension. */
export function mimeTypeOf(filename: string, fallback = "application/octet-stream") {
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (extension && MIME_TYPES[extension]) || fallback;
}

/**
 * Decodes base64 content. Agents sometimes send a data URL, so the function
 * removes the "data:...;base64," prefix and returns its MIME type.
 */
export function decodeBase64(value: string): { data: Buffer; mimeType?: string } {
  const dataUrl = value.match(/^data:([^;,]*)(?:;[^,]*)?;base64,/i);
  const body = (dataUrl ? value.slice(dataUrl[0].length) : value).replace(/\s+/g, "");
  // Buffer.from skips characters that are not base64, so check the content first.
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(body) || body.length % 4 === 1) {
    throw new Error("content_base64 is not valid base64.");
  }
  return { data: Buffer.from(body, "base64"), mimeType: dataUrl?.[1] || undefined };
}

/** The file name, MIME type, and content of an attachment that has its content in the input. */
export function inlineAttachment(input: AttachmentInput) {
  const filename = input.filename?.trim();
  if (!filename) throw new Error("Each attachment with content_base64 or text needs a filename.");
  if (input.content_base64 !== undefined) {
    const { data, mimeType } = decodeBase64(input.content_base64);
    return { filename, contentType: input.mime_type || mimeType || mimeTypeOf(filename), content: data };
  }
  if (input.text !== undefined) {
    return {
      filename,
      contentType: input.mime_type || mimeTypeOf(filename, "text/plain"),
      content: Buffer.from(input.text, "utf8"),
    };
  }
  throw new Error(`Give content_base64, text, or message_id and attachment_id for ${filename}.`);
}
