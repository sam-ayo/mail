import { useEffect, useState } from "react";

/** True when the browser can send a file to the share sheet of the system. */
export function canShareFiles() {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([""], "file.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
}

/**
 * Loads an attachment as a File while the viewer is open. Safari opens the
 * share sheet only during a tap, so the file must be ready before the tap.
 */
export function useAttachmentFile(url: string | null, filename: string, mimeType: string) {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!url) return;
    let cancelled = false;
    fetch(url, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (!cancelled) setFile(new File([blob], filename, { type: mimeType || blob.type }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, filename, mimeType]);
  return file;
}

/**
 * Opens the share sheet of the system with the file. The user can then send it to a
 * contact, save it to Files, or print it. Returns false when the user cancels.
 */
export async function shareFile(file: File) {
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
}

export function canPrint(mimeType: string) {
  return /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/.test(mimeType);
}

const PRINT_ROOT = "print-root";

/**
 * Prints an image, a PDF, or a text file. The function puts the file in a part of the
 * page that only the printer sees, and then opens the print dialog of the browser.
 * The function draws each PDF page as a picture, because iOS cannot print a PDF in a frame.
 */
export async function printFile(file: File) {
  document.getElementById(PRINT_ROOT)?.remove();
  const root = document.createElement("div");
  root.id = PRINT_ROOT;
  const urls: string[] = [];

  if (file.type === "application/pdf") {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      standardFontDataUrl: "/pdfjs-fonts/",
    });
    try {
      const pdf = await task.promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        // A scale of 2 gives 144 dots per inch, which is sufficient for a document on paper.
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = document.createElement("img");
        img.src = url;
        img.className = "print-page";
        root.append(img);
      }
    } finally {
      void task.destroy();
    }
  } else if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    urls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.className = "print-image";
    root.append(img);
  } else {
    const pre = document.createElement("pre");
    pre.className = "print-text";
    pre.textContent = await file.text();
    root.append(pre);
  }

  document.body.append(root);
  await Promise.all(
    Array.from(root.querySelectorAll("img"), (img) => img.decode().catch(() => {})),
  );

  const cleanup = () => {
    document.documentElement.classList.remove("printing");
    root.remove();
    for (const url of urls) URL.revokeObjectURL(url);
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  document.documentElement.classList.add("printing");
  window.print();
}
