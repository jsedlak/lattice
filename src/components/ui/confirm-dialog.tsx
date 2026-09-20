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

/** One button in a multi-way dialog. `value` is what the promise resolves to. */
export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  destructive?: boolean;
}

export interface ChooseOptions<T extends string> {
  title: string;
  description?: string;
  /** Rendered left to right; the last one is focused, so Enter picks it. */
  options: ChoiceOption<T>[];
  cancelLabel?: string;
}

type Choose = <T extends string>(opts: ChooseOptions<T>) => Promise<T | null>;

const ChooseContext = React.createContext<Choose>(() => Promise.resolve(null));

/** `const choose = useChoose()` → `await choose({ title, options })` resolves to
 *  the picked option's value, or null on cancel/escape. For dialogs with more
 *  than one way forward (Replace / Keep both). */
export function useChoose(): Choose {
  return React.useContext(ChooseContext);
}

/** `const confirm = useConfirm()` → `await confirm({ title, ... })` resolves to
 *  true/false. Replaces window.confirm with a styled alert dialog. */
export function useConfirm() {
  const choose = useChoose();
  return React.useCallback(
    async (opts: ConfirmOptions) =>
      (await choose({
        title: opts.title,
        description: opts.description,
        cancelLabel: opts.cancelLabel,
        options: [
          { value: "ok", label: opts.confirmLabel ?? "Continue", destructive: opts.destructive },
        ],
      })) === "ok",
    [choose],
  );
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; opts: ChooseOptions<string> }>({
    open: false,
    opts: { title: "", options: [] },
  });
  const resolveRef = React.useRef<((value: string | null) => void) | null>(null);
  const actionRef = React.useRef<HTMLButtonElement>(null);

  const choose = React.useCallback(
    <T extends string>(opts: ChooseOptions<T>) =>
      new Promise<T | null>((resolve) => {
        resolveRef.current = resolve as (value: string | null) => void;
        setState({ open: true, opts });
      }),
    [],
  );

  const settle = React.useCallback((value: string | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null; // idempotent — later calls (e.g. onOpenChange) no-op
    setState((s) => ({ ...s, open: false }));
  }, []);

  const last = state.opts.options.length - 1;

  return (
    <ChooseContext.Provider value={choose}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(open) => !open && settle(null)}>
        <AlertDialogContent
          // Radix focuses Cancel by default, which makes Enter dismiss the
          // dialog. Focus the primary action instead so Enter accepts (Escape
          // still cancels) — preventDefault stops Radix's own focus handler.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            actionRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{state.opts.title}</AlertDialogTitle>
            {state.opts.description && (
              <AlertDialogDescription>{state.opts.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(null)}>
              {state.opts.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            {state.opts.options.map((opt, i) => (
              <AlertDialogAction
                key={opt.value}
                ref={i === last ? actionRef : undefined}
                destructive={opt.destructive}
                onClick={() => settle(opt.value)}
              >
                {opt.label}
              </AlertDialogAction>
            ))}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ChooseContext.Provider>
  );
}
