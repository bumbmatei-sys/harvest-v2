/** Derived from Shadcn UI Kit item form-layout1 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 4). Visual reference only; local changes: docs/ui-sources.md. */
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A titled group of fields. `as="section"` (default) is a named region with a heading, an optional actions slot and an optional split layout
 * (title beside the fields from 1024px, for long settings pages). `as="fieldset"` is a labelled group (a legend) for radios and checkboxes that
 * belong together; it is always stacked, with no divider and no actions slot. The description is optional and should stay to one short line: use it only for a
 * consequence or constraint. Fields go inside as ordinary `Field` elements.
 */
export function FormSection({ title, description, as = "section", layout = "stacked", divided, actions, className, children }: {
  title: React.ReactNode; description?: React.ReactNode; as?: "section" | "fieldset"; layout?: "stacked" | "split"; divided?: boolean;
  actions?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  const id = useId();
  const describedBy = description ? `${id}-description` : undefined;
  const note = description ? <p id={describedBy} className="text-sm text-muted-foreground">{description}</p> : null;
  if (as === "fieldset") return <fieldset data-slot="form-section" aria-describedby={describedBy} className={cn("flex min-w-0 flex-col gap-4", className)}>
    <legend className="mb-1 text-base font-semibold">{title}</legend>{note}<div className="min-w-0 space-y-4">{children}</div></fieldset>;
  const split = layout === "split";
  return <section data-slot="form-section" aria-labelledby={`${id}-title`} aria-describedby={describedBy}
    className={cn("min-w-0 gap-4", split ? "grid lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-8" : "flex flex-col", divided && "border-t pt-6", className)}>
    <div className="min-w-0 space-y-1">
      <div className={cn("flex flex-wrap items-center justify-between gap-2", split && "lg:flex-col lg:items-start")}><h3 id={`${id}-title`} className="text-base font-semibold">{title}</h3>{actions && <div className="flex items-center gap-2">{actions}</div>}</div>
      {note}
    </div>
    <div className="min-w-0 space-y-4">{children}</div>
  </section>;
}
