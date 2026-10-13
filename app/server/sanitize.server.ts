import sanitizeHtml from "sanitize-html";

// Selectors for quoted replies from common mail clients. The reading pane
// hides them until the person asks to see them.
const QUOTE_SELECTORS = [
  ".gmail_quote",
  "blockquote[type=cite]",
  ".yahoo_quoted",
  "#divRplyFwdMsg",
  "#divRplyFwdMsg ~ *",
  "#appendonsend ~ *",
  "#mail-editor-reference-message-container",
];

const QUOTE_MARKERS = /class="[^"]*(gmail_quote|yahoo_quoted)|type="cite"|id="(divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)"/;

// In dark mode, the frame inverts the email and turns the hue back, so most
// colours keep their hue. Images and background images get a second inversion,
// so they show with their true colours. The parent sets the "dark" class.
const BASE_STYLES = `
html,body{margin:0;padding:0;background:#fff;color:#18181b}
html body,html:root{height:auto !important;min-height:0 !important}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;overflow-wrap:anywhere;padding:4px 2px}
img{max-width:100%;height:auto}
table{max-width:100%}
td,th{overflow-wrap:break-word}
pre{white-space:pre-wrap}
a{color:#4f46e5}
body.hide-quotes ${QUOTE_SELECTORS.join(", body.hide-quotes ")}{display:none !important}
html.dark{background:oklch(22% 0.022 277);color-scheme:dark}
html.dark body{background:transparent;filter:invert(1) hue-rotate(180deg)}
html.dark body :is(img,video,picture,svg,[background],[style*="background-image"]):not(:is([background],[style*="background-image"]) *){filter:invert(1) hue-rotate(180deg)}
`;

const CSP =
  "default-src 'none'; img-src 'self' https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:";

interface Options {
  /** Maps a Content-ID to a URL, for inline images. */
  resolveCid: (contentId: string) => string | undefined;
}

function isTrackingPixel(attribs: Record<string, string>) {
  const width = Number(attribs.width);
  const height = Number(attribs.height);
  return width <= 1 && height <= 1 && !Number.isNaN(width) && !Number.isNaN(height);
}

export function sanitizeEmailHtml(html: string, { resolveCid }: Options) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "style",
      "center",
      "font",
      "h1",
      "h2",
      "span",
      "u",
      "s",
      "strike",
      "big",
      "small",
      "col",
      "colgroup",
    ],
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title"],
    allowVulnerableTags: true,
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "id",
        "align",
        "valign",
        "width",
        "height",
        "bgcolor",
        "border",
        "color",
        "dir",
        "lang",
        "title",
        "type",
      ],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt"],
      font: ["face", "size"],
      table: ["cellpadding", "cellspacing", "background"],
      td: ["colspan", "rowspan", "nowrap", "background"],
      th: ["colspan", "rowspan", "nowrap", "background"],
      col: ["span"],
      colgroup: ["span"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
      img: (tagName, attribs) => {
        if (attribs.src?.startsWith("cid:")) {
          const url = resolveCid(attribs.src.slice(4));
          return { tagName, attribs: { ...attribs, src: url ?? "" } };
        }
        return { tagName, attribs };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && isTrackingPixel(frame.attribs),
  });
}

/** Wraps sanitized HTML in a document for a sandboxed iframe. */
export function emailDocument(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank"><style>${BASE_STYLES}</style></head><body class="hide-quotes">${body}</body></html>`;
}

export function hasQuotedHtml(html: string) {
  return QUOTE_MARKERS.test(html);
}
