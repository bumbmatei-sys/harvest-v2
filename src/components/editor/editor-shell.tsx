"use client";
import { Check, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type EditorStep = { id: string; label: string; done?: boolean; disabled?: boolean; badge?: string };

/**
 * Shared resource editor layout (ADR 0013 §12): steps on the left, settings in the centre, live preview on the
 * right, and always-visible actions in the header. Design follows the Eden reference editor; style is Studio Admin
 * via shared shadcn components. On small screens the steps become a scrollable bar and the preview opens in a sheet.
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
      <nav aria-label={stepsLabel} className="min-w-0">
        <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {steps.map((step, index) => {
            const active = step.id === current;
            return <li key={step.id} className="shrink-0 lg:shrink">
              <button type="button" onClick={() => !step.disabled && onStep(step.id)} aria-current={active ? "step" : undefined} aria-disabled={step.disabled || undefined}
                className={cn("flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors lg:min-h-9",
                  active ? "bg-muted font-medium" : "hover:bg-muted/60", step.disabled && "cursor-not-allowed text-muted-foreground hover:bg-transparent")}>
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs" aria-hidden="true">{step.done ? <Check className="size-3" /> : index + 1}</span>
                <span className="whitespace-nowrap lg:flex-1">{step.label}</span>
                {step.badge && <Badge variant="secondary" className="whitespace-nowrap">{step.badge}</Badge>}
              </button>
            </li>;
          })}
        </ol>
      </nav>
      <section className="min-w-0 space-y-6">{children}</section>
      {preview && <aside aria-label={previewLabel} className="hidden min-w-0 xl:block"><div className="sticky top-4">{preview}</div></aside>}
    </div>
  </div>;
}
