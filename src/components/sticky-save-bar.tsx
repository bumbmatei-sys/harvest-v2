"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { coveredByBar, isKeyboardOpen, saveBarStatus } from "@/lib/sticky-save-bar";
import { cn } from "@/lib/utils";

/**
 * Save and Discard for a form with unsaved changes. Hand-written (no kit item). The bar exists only while `dirty` (or while a save is running);
 * it sticks to the bottom of the content with phone safe-area padding, and while the on-screen keyboard is open it stops sticking so it never
 * takes space from the field being typed in. A control focused behind the bar by keyboard (not by a pointer press, which must not move mid-click) is scrolled clear of it. A polite live region announces "Unsaved
 * changes" and "Saving". By default it also guards leaving: links, Back/Forward and closing the tab ask first (`guard={false}` when the page
 * already uses `useUnsavedChangesGuard` itself). Save is `onSave`, or a submit button for the form named by `form`.
 */
export function StickySaveBar({ dirty, busy = false, onSave, onDiscard, form, saveLabel, savingLabel, saveDisabled = false, guard = true, className }: {
  dirty: boolean; busy?: boolean; onSave?: () => void; onDiscard: () => void; form?: string; saveLabel?: string; savingLabel?: string;
  saveDisabled?: boolean; guard?: boolean; className?: string;
}) {
  const t = useTranslations("ComponentsStickySaveBar");
  const bar = useRef<HTMLDivElement>(null);
  const [keyboard, setKeyboard] = useState(false);
  const { destination, setDestination, leave } = useUnsavedChangesGuard(guard && (dirty || busy));
  const visible = dirty || busy, status = saveBarStatus(dirty, busy);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboard(isKeyboardOpen(window.innerHeight, viewport.height));
    update(); viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    if (!visible || keyboard) return;
    // Only focus that does not come from a pointer press is scrolled clear (Tab, a script, a skip link). A press already lands on a visible point, and
    // scrolling between press and release moves the control away, so the release lands elsewhere and the click (a switch, a checkbox) is lost.
    let pressing = false;
    const press = () => { pressing = true; }, release = () => { pressing = false; };
    function focus(event: FocusEvent) {
      const target = event.target, element = bar.current;
      if (pressing || !(target instanceof HTMLElement) || !element || element.contains(target)) return;
      if (coveredByBar(target.getBoundingClientRect(), element.getBoundingClientRect())) target.scrollIntoView({ block: "center" });
    }
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("focusin", focus);
    };
  }, [visible, keyboard]);

  const aria = busy ? { "aria-disabled": true } : {};
  return <>
    <p role="status" aria-live="polite" className="sr-only">{status ? t(status) : ""}</p>
    {visible && <div ref={bar} data-slot="sticky-save-bar" data-keyboard={keyboard || undefined}
      className={cn("z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-sm", keyboard ? "relative" : "sticky bottom-2", className)}>
      <span className="text-sm text-muted-foreground">{t("unsaved")}</span>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" size="responsive" className="aria-disabled:opacity-70" {...aria} onClick={() => { if (!busy) onDiscard(); }}>{t("discard")}</Button>
        <Button type={form ? "submit" : "button"} form={form} size="responsive" className="aria-disabled:opacity-70" aria-disabled={busy || saveDisabled || undefined}
          onClick={(event) => { if (busy || saveDisabled) { event.preventDefault(); return; } if (!form) onSave?.(); }}>
          {busy ? <><Spinner decorative size="sm" />{savingLabel ?? t("saving")}</> : (saveLabel ?? t("save"))}</Button>
      </div>
    </div>}
    {guard && <ConfirmDialog tone="neutral" open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }}
      title={t("leaveTitle")} description={t("leaveBody")} cancelLabel={t("stay")} confirmLabel={t("leave")} onConfirm={leave} />}
  </>;
}
