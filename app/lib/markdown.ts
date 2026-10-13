import { Marked } from "marked";
import { escapeHtml } from "./compose";

// Many email clients remove <style> blocks, so each element gets inline styles.
const STYLES: Record<string, string> = {
  p: "margin:0 0 1em",
  h1: "margin:0 0 .6em;font-size:1.5em;font-weight:600;line-height:1.25",
  h2: "margin:0 0 .6em;font-size:1.3em;font-weight:600;line-height:1.25",
  h3: "margin:0 0 .6em;font-size:1.15em;font-weight:600;line-height:1.25",
  h4: "margin:0 0 .6em;font-size:1em;font-weight:600",
  h5: "margin:0 0 .6em;font-size:.9em;font-weight:600",
  h6: "margin:0 0 .6em;font-size:.85em;font-weight:600",
  ul: "margin:0 0 1em;padding-left:1.5em;list-style-type:disc",
  ol: "margin:0 0 1em;padding-left:1.5em;list-style-type:decimal",
  a: "color:#2563eb;text-decoration:underline",
  blockquote: "margin:0 0 1em;padding-left:1em;border-left:3px solid #d4d4d8;color:#71717a",
  pre: "margin:0 0 1em;padding:.75em 1em;border-radius:6px;background:rgba(127,127,127,.12);overflow-x:auto;font-size:13px;line-height:1.45",
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;padding:.1em .3em;border-radius:4px;background:rgba(127,127,127,.12)",
  table: "margin:0 0 1em;border-collapse:collapse",
  th: "padding:.35em .75em;border:1px solid #d4d4d8;font-weight:600;text-align:left",
  td: "padding:.35em .75em;border:1px solid #d4d4d8",
  hr: "margin:1.5em 0;border:0;border-top:1px solid #d4d4d8",
  img: "max-width:100%",
};

const SAFE_URL = /^(https?:|mailto:|tel:|#|\/)/i;

const marked = new Marked({
  gfm: true,
  // People expect Return to start a new line in an email, as it does in plain text.
  breaks: true,
  renderer: {
    // Show raw HTML as text. A message must look the same as the Markdown that the person wrote.
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_URL.test(href)) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    },
    image({ href, title, text }) {
      if (!/^https?:/i.test(href)) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr}>`;
    },
  },
});

function addStyles(html: string) {
  return html
    .replace(/<(\w+)([\s>/])/g, (match, tag: string, next: string) =>
      STYLES[tag] ? `<${tag} style="${STYLES[tag]}"${next}` : match,
    )
    // Code inside a block takes the style of the block.
    .replace(/(<pre[^>]*>)<code style="[^"]*"/g, '$1<code style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"');
}

/** Converts the Markdown that a person wrote into HTML for an email. */
export function markdownToHtml(markdown: string) {
  return addStyles(marked.parse(markdown, { async: false }).trim());
}
