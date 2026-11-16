/** Derived from Shadcn UI Kit item alert-dialog1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 3). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { runConfirm, type ConfirmResult } from "@/lib/confirm-flow";

/**
 * A confirmation step before a consequential action. Wraps AlertDialog: the cancel button gets first focus, the
 * confirm button is destructive or neutral, and while `onConfirm` runs both buttons are aria-disabled (not removed
 * from the tab order, so keyboard focus stays where it is) and the dialog cannot be dismissed. A thrown error or a
 * returned message keeps it open. All text comes from the caller; it never fetches or decides permissions.
 */
export function ConfirmDialog({ trigger, open, onOpenChange, tone = "destructive", title, description, confirmLabel, cancelLabel, busyLabel, failedLabel, onConfirm, returnFocusRef }: {
  /** Element that opens the dialog (rendered with asChild). Omit when `open` is controlled elsewhere. */
  trigger?: React.ReactNode;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  tone?: "destructive" | "neutral";
  title: string; description?: string; confirmLabel: string; cancelLabel: string;
  /** Confirm button text while busy; defaults to `confirmLabel`. */
  busyLabel?: string;
  /** Shown when `onConfirm` throws; defaults to the shared catalogue message. */
  failedLabel?: string;
  onConfirm: () => ConfirmResult;
  /** Where focus returns on close when the opener no longer exists (for example a menu item). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("ComponentsConfirmDialog");
  const [inner, setInner] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const running = useRef(false);
  const isOpen = open ?? inner;
  function apply(next: boolean) { if (!next) setError(""); setInner(next); onOpenChange?.(next); }
  async function confirm(event: React.MouseEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    const outcome = await runConfirm(onConfirm, failedLabel ?? t("failed"));
    running.current = false; setBusy(false);
    if (outcome.ok) apply(false); else setError(outcome.message);
  }
  const blocked = busy ? { "aria-disabled": true as const } : {};
  const blockedClass = "aria-disabled:pointer-events-none aria-disabled:opacity-50";
  return <AlertDialog open={isOpen} onOpenChange={(next) => { if (!busy || next) apply(next); }}>
    {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
    <AlertDialogContent data-tone={tone} aria-busy={busy || undefined} {...(description ? {} : { "aria-describedby": undefined })}
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onCloseAutoFocus={(event) => { const target = returnFocusRef?.current; if (target) { event.preventDefault(); target.focus(); } }}>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle>{description && <AlertDialogDescription>{description}</AlertDialogDescription>}</AlertDialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <span role="status" className="sr-only">{busy ? (busyLabel ?? confirmLabel) : ""}</span>
      <AlertDialogFooter>
        <AlertDialogCancel size="responsive" className={blockedClass} {...blocked}>{cancelLabel}</AlertDialogCancel>
        <AlertDialogAction size="responsive" variant={tone === "destructive" ? "destructive" : "default"} className={blockedClass} {...blocked} onClick={(event) => void confirm(event)}>
          {busy && <Spinner decorative />}{busy ? (busyLabel ?? confirmLabel) : confirmLabel}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
