import { useEffect, useRef, useState } from "react";

/**
 * Draws each page of a PDF on a canvas. iOS shows only the first page of a
 * PDF in an iframe, so the viewer cannot use the browser's own PDF view.
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
      const task = pdfjs.getDocument({ url });
      destroy = () => void task.destroy();
      const pdf = await task.promise;
      const width = root.clientWidth;
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
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
    <div className="min-h-0 flex-1 overflow-auto bg-zinc-100 p-2 dark:bg-zinc-950">
      {failed && (
        <p className="p-6 text-center text-sm text-zinc-500">
          Could not show {title}. Use the download button to open it.
        </p>
      )}
      <div ref={container} aria-label={title} role="document" className="mx-auto flex max-w-3xl flex-col gap-2" />
    </div>
  );
}
