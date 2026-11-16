"use client";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Stepper, type StepperStep } from "@/components/stepper";

export type EditorStep = StepperStep;

/**
 * Shared resource editor layout (ADR 0013 §12): steps on the left, settings in the centre, live preview on the
 * right, and always-visible actions in the header. Design follows the Eden reference editor; style is Studio Admin
 * via shared shadcn components. The steps are the shared Stepper (`nav` layout). On small screens they become a scrollable bar and the preview opens in a sheet.
 * Data, saving and permissions stay with the consumer.
 */
export function EditorShell({ breadcrumb, title, status, actions, steps, current, onStep, stepsLabel, preview, previewLabel, children }: {
  breadcrumb?: React.ReactNode; title: string; status?: React.ReactNode; actions?: React.ReactNode;
  steps: readonly EditorStep[]; current: string; onStep: (id: string) => void; stepsLabel: string;
  preview?: React.ReactNode; previewLabel: string; children: React.ReactNode;
}) {
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
