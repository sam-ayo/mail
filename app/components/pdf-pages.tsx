import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import "./pdf-xfa.css";

const SAFE_URL = /^(https?|mailto):/i;

/** Opens XFA form links in a new tab. It does not accept a script URL. */
const xfaLinks = {
  addLinkAttributes(link: HTMLAnchorElement, href: string) {
    if (!SAFE_URL.test(href)) return;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  },
};

/**
 * Puts a link on a page for each link annotation of the page. A web link
 * opens in a new tab. A link to a part of the PDF scrolls to its page.
 */
async function addLinks(
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
  viewport: PageViewport,
  sheet: HTMLElement,
  sheets: HTMLElement[],
) {
  const annotations = await page.getAnnotations({ intent: "display" });
  for (const annotation of annotations) {
    if (annotation.subtype !== "Link" || !annotation.rect) continue;
    const link = document.createElement("a");
    if (typeof annotation.url === "string" && SAFE_URL.test(annotation.url)) {
      link.href = annotation.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = annotation.url;
    } else if (annotation.dest) {
      const dest = annotation.dest;
      link.href = "#";
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        const target = explicit?.[0];
        if (target == null) return;
        const index = typeof target === "number" ? target : await pdf.getPageIndex(target);
        sheets[index]?.scrollIntoView({ block: "start" });
      });
    } else {
      continue;
    }
    // Use percentages, so the links stay on their text when the page changes size.
    const [left, bottom, right, top] = annotation.rect;
    const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
    const [x2, y2] = viewport.convertToViewportPoint(right, top);
    link.className = "absolute";
    link.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`;
    link.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
    link.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`;
    link.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
    sheet.append(link);
  }
}

/**
 * Draws each page of a PDF on a canvas. iOS shows only the first page of a
 * PDF in an iframe, so the viewer cannot use the browser's own PDF view.
 * An XFA form (an Adobe LiveCycle form) has no page content of its own, so
 * the viewer draws its pages as HTML.
 */
export function PdfPages({ url, title }: { url: string; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setFailed(false);

    (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ url, enableXfa: true, standardFontDataUrl: "/pdfjs-fonts/" });
      destroy = () => void task.destroy();
      const pdf = await task.promise;
      const width = root.clientWidth;
      const ratio = window.devicePixelRatio || 1;
      const sheets: HTMLElement[] = [];
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        if (pdf.isPureXfa) {
          const xfaHtml = await page.getXfa();
          if (cancelled || !xfaHtml) continue;
          const sheet = document.createElement("div");
          sheet.className = "relative shrink-0 overflow-hidden bg-white shadow-sm";
          sheet.style.width = `${viewport.width}px`;
          sheet.style.height = `${viewport.height}px`;
          const layer = document.createElement("div");
          sheet.append(layer);
          root.append(sheet);
          sheets[n - 1] = sheet;
          pdfjs.XfaLayer.render({
            viewport: viewport.clone({ dontFlip: true }),
            div: layer,
            xfaHtml,
            annotationStorage: pdf.annotationStorage,
            linkService: xfaLinks as unknown as Parameters<typeof pdfjs.XfaLayer.render>[0]["linkService"],
            intent: "display",
          });
          continue;
        }
        const sheet = document.createElement("div");
        sheet.className = "relative shrink-0 bg-white shadow-sm";
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.className = "block w-full";
        sheet.append(canvas);
        root.append(sheet);
        sheets[n - 1] = sheet;
        await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
          .promise;
        if (!cancelled) await addLinks(pdf, page, viewport, sheet, sheets);
      }
    })().catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      destroy?.();
      root.replaceChildren();
    };
  }, [url]);

  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-zinc-100 p-2 dark:bg-zinc-950">
      {failed && (
        <p className="p-6 text-center text-sm text-zinc-500">
          Could not show {title}. Use the download button to open it.
        </p>
      )}
      <div ref={container} aria-label={title} role="document" className="mx-auto flex max-w-3xl flex-col gap-2" />
    </div>
  );
}
