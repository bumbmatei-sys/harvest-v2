import { toast } from "sonner";

/**
 * Harvest toast helper. The only place application code reaches the toast library, so copy, kinds and the optional action stay uniform.
 * Callers pass text from the message catalogue (`useTranslations`); the source guard rejects raw string literals here.
 * Use for confirmations that follow an action. An error that must stay visible beside a form field keeps its inline alert as well.
 */
export type ToastAction = { label: string; onClick: () => void };
export type ToastOptions = {
  /** Second line, for example what was changed. */
  description?: string;
  /** Optional single action, for example Undo. The toast closes when it is used. */
  action?: ToastAction;
  /** Reusing an id replaces the toast instead of stacking a duplicate. */
  id?: string | number;
  /** Milliseconds; defaults to the outlet's duration. Errors with an action should not auto-close too quickly. */
  duration?: number;
};
export type ToastKind = "success" | "error" | "info";

function show(kind: ToastKind, title: string, options: ToastOptions = {}) {
  const { action, ...rest } = options;
  return toast[kind](title, { ...rest, ...(action ? { action: { label: action.label, onClick: action.onClick } } : {}) });
}

export const notify = {
  success: (title: string, options?: ToastOptions) => show("success", title, options),
  error: (title: string, options?: ToastOptions) => show("error", title, options),
  info: (title: string, options?: ToastOptions) => show("info", title, options),
  dismiss: (id?: string | number) => toast.dismiss(id),
};
