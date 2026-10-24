import { Dialog } from "@base-ui/react/dialog";
import { useRef } from "react";
import { ArrowLeft, DownloadSimple } from "./icons";
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

/**
 * Shows an image, a PDF, or a text file inside the app. A new tab has no way back on a
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
                <a
                  href={shown.download}
                  aria-label="Download"
                  className={BUTTON}
                >
                  <DownloadSimple className="size-5" />
                </a>
              </div>
              {shown.mimeType.startsWith("image/") ? (
                <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-zinc-50 p-4 dark:bg-zinc-950">
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
