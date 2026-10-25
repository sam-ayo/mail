import sanitizeHtml from "sanitize-html";
import { proxiedImageUrl } from "./image-proxy.server";

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
// colours keep their hue. The frame is transparent, so the email shows on the
// colour of the message card. Images and background images get a second inversion,
// so they show with their true colours. The parent sets the "dark" class.
// The frame always uses the light colour scheme. If the email also applied
// its own dark styles, the inversion would turn its light text dark again.
const BASE_STYLES = `
html,body{margin:0;padding:0;background:#fff;color:#18181b}
html{overflow-x:hidden}
html body,html:root{height:auto !important;min-height:0 !important}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;overflow-wrap:anywhere;padding:4px 2px}
img{max-width:100%;height:auto}
table{max-width:100%}
td,th{overflow-wrap:break-word}
pre{white-space:pre-wrap}
a{color:#4f46e5}
body.hide-quotes ${QUOTE_SELECTORS.join(", body.hide-quotes ")}{display:none !important}
html,html:root{color-scheme:light only !important}
html.dark{background:transparent}
html.dark body{background:transparent;filter:invert(1) hue-rotate(180deg)}
html.dark body :is(img,video,picture,svg,[background],[style*="background-image"]):not(:is([background],[style*="background-image"]) *){filter:invert(1) hue-rotate(180deg)}
`;

// The frame loads nothing from other servers. Remote images go through the
// app's image proxy, so senders do not get the reader's IP address. Remote
// stylesheets and fonts do not load, and the email shows with other fonts.
const CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src data:";

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

/** Changes the remote URLs in CSS to proxy URLs. */
function proxyCssUrls(css: string) {
  return css.replace(CSS_URL, (match, _quote, url: string) => {
    const proxied = proxiedImageUrl(url);
    return proxied === url ? match : `url("${proxied}")`;
  });
}

// sanitize-html gives the text of a <style> tag as it is, with no filter.
// The HTML parser also ends a <style> tag at the first "</style".
const STYLE_TAG = /(<style\b[^>]*>)([\s\S]*?)(<\/style)/gi;

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
  html = html.replace(STYLE_TAG, (_match, open: string, css: string, close: string) => open + proxyCssUrls(css) + close);
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
        return { tagName, attribs: attribs.src ? { ...attribs, src: proxiedImageUrl(attribs.src) } : attribs };
      },
      "*": (tagName, attribs) => {
        const next = { ...attribs };
        if (next.style) next.style = proxyCssUrls(next.style);
        if (next.background) next.background = proxiedImageUrl(next.background);
        return { tagName, attribs: next };
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
