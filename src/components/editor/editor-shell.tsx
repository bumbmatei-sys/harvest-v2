"use client";
import { cn } from "@/lib/utils";
import { useCallback, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { PreviewSurface } from "@/components/editor/preview-panel";
import { Stepper, type StepperStep } from "@/components/stepper";
import { EditorStepBar } from "@/components/editor/editor-step-bar";
import { useEditorContext } from "@/components/editor/editor-context";
import { editorStepState, type EditorContextData } from "@/lib/editor-context";

/** `attention` marks a step that needs the user's input (shown beside done and not started in the editing sidebar). */
export type EditorStep = StepperStep & { attention?: boolean };
/** What the editing sidebar shows about the item, beyond the title and steps the shell already has. */
/** The live preview (shell slice 3b): a render function over where it is shown. `close(after)` closes the sheet and then runs `after` (for example to focus a form field). */
export type LivePreview = (surface: PreviewSurface, controls: { close: (after?: () => void) => void }) => React.ReactNode;
export type EditorSidebarInfo = Pick<EditorContextData, "typeLabel" | "status" | "back" | "openPage" | "dirty">;

/**
 * Shared resource editor layout (ADR 0013 §12): steps on the left, settings in the centre, live preview on the
 * right, and always-visible actions in the header. Design follows the Eden reference editor; style is Studio Admin
 * via shared shadcn components. Without the shell's editing sidebar (flag off) the steps are the shared Stepper (`nav` layout): a scrollable bar on small
 * screens and the preview in a sheet. With `sidebar` and the shell hosting editors (shell slice 3a, behind HARVEST_SHELL_MODES) the steps move into the
 * shell's editing sidebar; below 1024px a "Step n of m" bar with an All steps sheet replaces them, and the in-page step list is not rendered.
 * Data, saving and permissions stay with the consumer.
 */
export function EditorShell({ breadcrumb, title, status, actions, steps, current, onStep, stepsLabel, preview, livePreview, previewLabel, sidebar, children }: {
  breadcrumb?: React.ReactNode; title: string; status?: React.ReactNode; actions?: React.ReactNode;
  steps: readonly EditorStep[]; current: string; onStep: (id: string) => void; stepsLabel: string;
  preview?: React.ReactNode; livePreview?: LivePreview; previewLabel: string; sidebar?: EditorSidebarInfo; children: React.ReactNode;
}) {
  const data: EditorContextData | null = sidebar ? {
    title, typeLabel: sidebar.typeLabel, status: sidebar.status, back: sidebar.back, openPage: sidebar.openPage, dirty: sidebar.dirty, stepsLabel, current,
    steps: steps.map((step) => ({ id: step.id, label: step.label, state: editorStepState(step), badge: step.badge })),
  } : null;
  const hosted = useEditorContext(data, onStep);
  const t = useTranslations("EditorMode");
  // Live preview (slice 3b): mounted only where it is shown: a column from 1280px, otherwise a full-screen (phone, tablet) or side (1024px+) sheet.
  const column = useMediaQuery("(min-width: 1280px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null), [after, setAfter] = useState<{ run: () => void } | null>(null);
  const openSheet = () => { opener.current = document.activeElement as HTMLElement | null; setSheetOpen(true); };
  const closeSheet = useCallback((then?: () => void) => { setAfter(then ? { run: then } : null); setSheetOpen(false); }, []);
  // The column replaces the sheet: a sheet left open while the viewport grows must not reopen when it shrinks again.
  if (column && sheetOpen) setSheetOpen(false);
  if (hosted && data && livePreview) return <div className="min-w-0 space-y-6" data-editor-hosted data-editor-live-preview>
    <EditorStepBar context={data} onStep={onStep} onPreview={openSheet} />
    <header className="space-y-3">
      {breadcrumb}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><h1 className="truncate text-[28px] font-semibold tracking-tight">{title}</h1>{status}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="min-h-11 max-lg:hidden xl:hidden" onClick={openSheet}><Eye aria-hidden="true" />{previewLabel}</Button>
          {actions}
        </div>
      </div>
    </header>
    <div className={cn("grid min-w-0 gap-6", preview && "xl:max-[1599px]:grid-cols-[minmax(0,1fr)_22rem] min-[1600px]:grid-cols-[minmax(0,1fr)_24rem]")}>
      <section className="min-w-0 space-y-6">{children}</section>
      {column && <aside aria-label={previewLabel} data-editor-preview className="min-w-0"><div className="sticky top-4">{livePreview("column", { close: closeSheet })}</div></aside>}
    </div>
    <Sheet open={sheetOpen && !column} onOpenChange={(open) => { if (open) openSheet(); else closeSheet(); }}>
      <SheetContent showCloseButton={false} aria-describedby={undefined} className="h-dvh w-full gap-0 p-0 sm:max-w-full lg:max-w-md"
        onCloseAutoFocus={(event) => { event.preventDefault(); if (after) { const { run } = after; setAfter(null); run(); } else opener.current?.focus(); }}>
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b py-2 pr-2">
          <SheetTitle>{t("previewDraft")}</SheetTitle>
          <SheetClose asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("closePreview")}><X aria-hidden="true" /></Button></SheetClose>
        </SheetHeader>
        <div className="min-h-0 flex-1 p-4">{livePreview("sheet", { close: closeSheet })}</div>
      </SheetContent>
    </Sheet>
  </div>;
  if (hosted && data) return <div className="min-w-0 space-y-6" data-editor-hosted>
    <EditorStepBar context={data} onStep={onStep} className="mb-4" />
    <header className="space-y-3">
      {breadcrumb}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><h1 className="truncate text-[28px] font-semibold tracking-tight">{title}</h1>{status}</div>
        <div className="flex flex-wrap items-center gap-2">
          {preview && <Sheet><SheetTrigger asChild><Button variant="outline" className="min-h-11 xl:hidden"><Eye aria-hidden="true" />{previewLabel}</Button></SheetTrigger>
            <SheetContent className="w-full overflow-y-auto sm:max-w-md"><SheetHeader><SheetTitle>{previewLabel}</SheetTitle></SheetHeader><div className="p-4">{preview}</div></SheetContent></Sheet>}
          {actions}
        </div>
      </div>
    </header>
    {/* Form first, preview column from 1280px (22rem, 24rem from 1600px) only when there is a preview, so an editor without one uses the full width; the steps live in the sidebar. */}
    <div className={cn("grid min-w-0 gap-6", preview && "xl:max-[1599px]:grid-cols-[minmax(0,1fr)_22rem] min-[1600px]:grid-cols-[minmax(0,1fr)_24rem]")}>
      <section className="min-w-0 space-y-6">{children}</section>
      {preview && <aside aria-label={previewLabel} data-editor-preview className="hidden min-w-0 xl:block"><div className="sticky top-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-editor-preview-label>{previewLabel}</p>{preview}</div></aside>}
    </div>
  </div>;
  return <div className="min-w-0 space-y-6">
    <header className="space-y-3">
      {breadcrumb}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><h1 className="truncate text-[28px] font-semibold tracking-tight">{title}</h1>{status}</div>
        <div className="flex flex-wrap items-center gap-2">
          {preview && <Sheet><SheetTrigger asChild><Button variant="outline" className="min-h-11 xl:hidden"><Eye aria-hidden="true" />{previewLabel}</Button></SheetTrigger>
            <SheetContent className="w-full overflow-y-auto sm:max-w-md"><SheetHeader><SheetTitle>{previewLabel}</SheetTitle></SheetHeader><div className="p-4">{preview}</div></SheetContent></Sheet>}
          {actions}
        </div>
      </div>
    </header>
    <div className={cn("grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]", preview && "xl:grid-cols-[13rem_minmax(0,1fr)_22rem]")}>
      <Stepper layout="nav" steps={steps} current={current} onSelect={onStep} label={stepsLabel} />
      <section className="min-w-0 space-y-6">{children}</section>
      {preview && <aside aria-label={previewLabel} className="hidden min-w-0 xl:block"><div className="sticky top-4">{preview}</div></aside>}
    </div>
  </div>;
}
