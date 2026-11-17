"use client";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Stepper, type StepperStep } from "@/components/stepper";
import { EditorStepBar } from "@/components/editor/editor-step-bar";
import { useEditorContext } from "@/components/editor/editor-context";
import { editorStepState, type EditorContextData } from "@/lib/editor-context";

/** `attention` marks a step that needs the user's input (shown beside done and not started in the editing sidebar). */
export type EditorStep = StepperStep & { attention?: boolean };
/** What the editing sidebar shows about the item, beyond the title and steps the shell already has. */
export type EditorSidebarInfo = Pick<EditorContextData, "typeLabel" | "status" | "back" | "openPage" | "dirty">;

/**
 * Shared resource editor layout (ADR 0013 §12): steps on the left, settings in the centre, live preview on the
 * right, and always-visible actions in the header. Design follows the Eden reference editor; style is Studio Admin
 * via shared shadcn components. Without the shell's editing sidebar (flag off) the steps are the shared Stepper (`nav` layout): a scrollable bar on small
 * screens and the preview in a sheet. With `sidebar` and the shell hosting editors (shell slice 3a, behind HARVEST_SHELL_MODES) the steps move into the
 * shell's editing sidebar; below 1024px a "Step n of m" bar with an All steps sheet replaces them, and the in-page step list is not rendered.
 * Data, saving and permissions stay with the consumer.
 */
export function EditorShell({ breadcrumb, title, status, actions, steps, current, onStep, stepsLabel, preview, previewLabel, sidebar, children }: {
  breadcrumb?: React.ReactNode; title: string; status?: React.ReactNode; actions?: React.ReactNode;
  steps: readonly EditorStep[]; current: string; onStep: (id: string) => void; stepsLabel: string;
  preview?: React.ReactNode; previewLabel: string; sidebar?: EditorSidebarInfo; children: React.ReactNode;
}) {
  const data: EditorContextData | null = sidebar ? {
    title, typeLabel: sidebar.typeLabel, status: sidebar.status, back: sidebar.back, openPage: sidebar.openPage, dirty: sidebar.dirty, stepsLabel, current,
    steps: steps.map((step) => ({ id: step.id, label: step.label, state: editorStepState(step), badge: step.badge })),
  } : null;
  const hosted = useEditorContext(data, onStep);
  if (hosted && data) return <div className="min-w-0 space-y-6" data-editor-hosted>
    <EditorStepBar context={data} onStep={onStep} />
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
    {/* Form first, preview column from 1280px (22rem, 24rem from 1600px); the steps live in the sidebar. */}
    <div className="grid min-w-0 gap-6 xl:max-[1599px]:grid-cols-[minmax(0,1fr)_22rem] min-[1600px]:grid-cols-[minmax(0,1fr)_24rem]">
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
    <div className="grid min-w-0 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_22rem]">
      <Stepper layout="nav" steps={steps} current={current} onSelect={onStep} label={stepsLabel} />
      <section className="min-w-0 space-y-6">{children}</section>
      {preview && <aside aria-label={previewLabel} className="hidden min-w-0 xl:block"><div className="sticky top-4">{preview}</div></aside>}
    </div>
  </div>;
}
