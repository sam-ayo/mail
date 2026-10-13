import { AlertDialog } from "@base-ui/react/alert-dialog";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "~/components/ui";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** The label of the button that confirms. The default is "OK". */
  confirmLabel?: string;
  /** Shows the confirm button in red, for an action that removes something. */
  danger?: boolean;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Replaces window.confirm with a dialog in the style of the app.
 * The browser dialog shows the host name and does not follow the theme.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({ title: "" });
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    // A second request cancels the first one.
    resolver.current?.(false);
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={open} onOpenChange={(next) => !next && settle(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-zinc-950/30 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <AlertDialog.Popup className="fixed inset-x-4 top-[20vh] z-50 mx-auto max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5 outline-none transition-[scale,opacity] duration-200 ease-out data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-starting-style:scale-[0.96] data-starting-style:opacity-0 dark:bg-zinc-900 dark:ring-white/10">
            <AlertDialog.Title dir="auto" className="text-lg font-semibold [overflow-wrap:anywhere]">
              {options.title}
            </AlertDialog.Title>
            {options.description && (
              <AlertDialog.Description className="mt-2 text-sm text-zinc-500 [overflow-wrap:anywhere]">
                {options.description}
              </AlertDialog.Description>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
              <Button variant={options.danger ? "danger" : "primary"} onClick={() => settle(true)}>
                {options.confirmLabel ?? "OK"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm needs a ConfirmProvider");
  return confirm;
}

/** The text for the removal of an account. The sidebar and the settings page use it. */
export function removeAccountPrompt(email: string): ConfirmOptions {
  return {
    title: `Remove ${email}?`,
    confirmLabel: "Remove",
    danger: true,
  };
}
