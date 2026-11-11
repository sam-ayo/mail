import { useEffect, useRef, useState } from "react";
import "./pdf-xfa.css";

/** Opens XFA form links in a new tab. It does not accept a script URL. */
const xfaLinks = {
  addLinkAttributes(link: HTMLAnchorElement, href: string) {
    if (!/^(https?|mailto):/i.test(href)) return;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  },
};

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
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.className = "block w-full bg-white shadow-sm";
        root.append(canvas);
        await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
          .promise;
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
