// Some senders encode text as UTF-8 but label it as Windows-1252 or Latin-1.
// Then each non-ASCII character shows as two to four wrong characters, for
// example "â€œ" in place of "“". This module finds those character groups and
// changes them back.

const WINDOWS_1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

/** The byte that each character has in Windows-1252, for the bytes 0x80 to 0xFF. */
const byteOf = new Map<string, number>();
for (let i = 0; i < 32; i++) {
  byteOf.set(WINDOWS_1252_HIGH[i]!, 0x80 + i);
  // A Latin-1 decoder gives the C1 control characters for these bytes.
  byteOf.set(String.fromCharCode(0x80 + i), 0x80 + i);
}
for (let i = 0xa0; i <= 0xff; i++) byteOf.set(String.fromCharCode(i), i);

// A character that has a UTF-8 continuation byte (0x80 to 0xBF).
const C = `[\\u0080-\\u00BF${WINDOWS_1252_HIGH.replace(/[\u0080-\u009F]/g, "")}]`;
const SEQUENCE = new RegExp(
  `(?:[\\u00C2-\\u00DF]${C}|[\\u00E0-\\u00EF]${C}{2}|[\\u00F0-\\u00F4]${C}{3})+`,
  "g",
);
const QUICK_CHECK = /[Â-ô]/;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Changes UTF-8 text that a decoder read as Windows-1252 back to the correct characters. */
export function repairMojibake(text: string): string;
export function repairMojibake(text: string | undefined): string | undefined;
export function repairMojibake(text: string | undefined) {
  if (!text || !QUICK_CHECK.test(text)) return text;
  return (
    text
      .replace(SEQUENCE, (match) => {
        const bytes = Uint8Array.from(match, (char) => byteOf.get(char)!);
        try {
          return utf8.decode(bytes);
        } catch {
          return match;
        }
      })
      // Some decoders drop the byte 0x9D, so the closing quote "”" shows as "â€" only.
      .replace(/â€(?![\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ])/g, "”")
  );
}

const SINGLE_BYTE_WESTERN = /^(?:us-ascii|ascii|iso-8859-1|iso-8859-15|latin1|latin-1|windows-1252|cp1252)$/i;

/**
 * Decodes the bytes of a message part. If the part says a Western single-byte
 * charset but the bytes are valid UTF-8 with non-ASCII characters, the bytes
 * are UTF-8, because real Windows-1252 text almost never is valid UTF-8.
 */
export function decodeText(bytes: Uint8Array, charset = "utf-8") {
  if (SINGLE_BYTE_WESTERN.test(charset.trim()) && bytes.some((b) => b >= 0x80)) {
    try {
      return utf8.decode(bytes);
    } catch {
      // The bytes are not UTF-8, so use the declared charset.
    }
  }
  try {
    return new TextDecoder(charset.trim()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
