import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { canPrint, canShareFiles, printFile, shareFile, useAttachmentFile } from "~/lib/attachment-actions";
import { ArrowLeft, CircleNotch, DownloadSimple, FileText, Printer, Share } from "./icons";
import { PdfPages } from "./pdf-pages";
import { FileName } from "./ui";

const BUTTON =
  "press grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 max-md:size-11 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

export type ViewedAttachment = {
  filename: string;
  mimeType: string;
  preview: string;
  download: string;
};

/** True when the viewer can show the file. Other files show a card with the file actions. */
export function canPreview(mimeType: string) {
  return /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf|text\/plain)$/.test(mimeType);
}

/**
 * Shows an image, a PDF, or a text file inside the app. The viewer can also send the
 * file to the share sheet of the system, and print it. A new tab has no way back on a
 * phone, mostly in the Home Screen app, so the viewer has its own back button.
 */
export function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: ViewedAttachment | null;
  onClose(): void;
}) {
  // Keep the last file while the viewer fades out.
  const last = useRef(attachment);
  if (attachment) last.current = attachment;
  const shown = last.current;
  const file = useAttachmentFile(attachment?.preview ?? null, shown?.filename ?? "", shown?.mimeType ?? "");
  // navigator is not available on the server, so check after the first render.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(canShareFiles()), []);
  const [printing, setPrinting] = useState(false);

  async function share() {
    if (!file) return;
    try {
      await shareFile(file);
    } catch {
      toast.error("Could not share the file. Try again.");
    }
  }

  async function print() {
    if (!file || printing) return;
    setPrinting(true);
    try {
      await printFile(file);
    } catch {
      toast.error("Could not print the file. Download it, then print it.");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Dialog.Root open={attachment !== null} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-zinc-950/60 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 md:inset-6 md:overflow-hidden md:rounded-2xl md:pt-0 md:pb-0 md:shadow-2xl md:ring-1 md:ring-black/5 dark:bg-zinc-900 md:dark:ring-white/10">
          {shown && (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
                {/* Not an IconButton: the dialog focuses this button, and its tooltip would show at once. */}
                <Dialog.Close aria-label="Back" className={BUTTON}>
                  <ArrowLeft className="size-5" />
                </Dialog.Close>
                <Dialog.Title className="min-w-0 flex-1">
                  <FileName name={shown.filename} className="text-sm font-medium" />
                </Dialog.Title>
                {canShare && (
                  <button
                    type="button"
                    aria-label="Share"
                    title="Share"
                    disabled={!file}
                    onClick={share}
                    className={`${BUTTON} disabled:opacity-40`}
                  >
                    <Share className="size-5" />
                  </button>
                )}
                {canPrint(shown.mimeType) && (
                  <button
                    type="button"
                    aria-label="Print"
                    title="Print"
                    disabled={!file || printing}
                    onClick={print}
                    className={`${BUTTON} disabled:opacity-40`}
                  >
                    {printing ? <CircleNotch className="size-5 animate-spin" /> : <Printer className="size-5" />}
                  </button>
                )}
                <a href={shown.download} aria-label="Download" title="Download" className={BUTTON}>
                  <DownloadSimple className="size-5" />
                </a>
              </div>
              {!canPreview(shown.mimeType) ? (
                <div className="grid min-h-0 flex-1 place-items-center bg-zinc-50 p-6 dark:bg-zinc-950">
                  <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                    <FileText className="size-10 text-zinc-400" />
                    <FileName name={shown.filename} className="text-sm font-medium" />
                    <p className="text-sm text-zinc-500">The app cannot show this type of file.</p>
                    <div className="flex gap-2">
                      {canShare && (
                        <button
                          type="button"
                          disabled={!file}
                          onClick={share}
                          className="press flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
                        >
                          <Share className="size-4" />
                          Share
                        </button>
                      )}
                      <a
                        href={shown.download}
                        className="press flex items-center gap-2 rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                      >
                        <DownloadSimple className="size-4" />
                        Download
                      </a>
                    </div>
                  </div>
                </div>
              ) : shown.mimeType.startsWith("image/") ? (
                <div className="grid min-h-0 flex-1 place-items-center overflow-auto overscroll-contain bg-zinc-50 p-4 dark:bg-zinc-950">
                  <img src={shown.preview} alt={shown.filename} className="max-h-full max-w-full object-contain" />
                </div>
              ) : shown.mimeType === "application/pdf" ? (
                <PdfPages url={shown.preview} title={shown.filename} />
              ) : (
                <iframe src={shown.preview} title={shown.filename} className="min-h-0 w-full flex-1" />
              )}
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
