"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

const ConfirmContext = React.createContext<(opts: ConfirmOptions) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

/** `const confirm = useConfirm()` → `await confirm({ title, ... })` resolves to
 *  true/false. Replaces window.confirm with a styled alert dialog. */
export function useConfirm() {
  return React.useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; opts: ConfirmOptions }>({
    open: false,
    opts: { title: "" },
  });
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setState({ open: true, opts });
      }),
    [],
  );

  const settle = React.useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null; // idempotent — later calls (e.g. onOpenChange) no-op
    setState((s) => ({ ...s, open: false }));
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state.opts.title}</AlertDialogTitle>
            {state.opts.description && (
              <AlertDialogDescription>{state.opts.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {state.opts.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              destructive={state.opts.destructive}
              onClick={() => settle(true)}
            >
              {state.opts.confirmLabel ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
