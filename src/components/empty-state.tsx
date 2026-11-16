/** Derived from Shadcn UI Kit item empty-state15 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 3). Visual reference only; local changes: docs/ui-sources.md. */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * Empty, no-match and nothing-here-yet states. Composes the Empty primitive: an icon, a title, an optional
 * description and at most one primary action (plus an optional secondary one). All text comes from the caller.
 */
export function EmptyState({ icon: Icon, title, description, action, secondary, size = "standard", headingLevel, solid = false, className }: {
  icon?: LucideIcon; title: string; description?: string;
  /** The one primary action (a button or link). Omit it when the viewer cannot act. */
  action?: React.ReactNode; secondary?: React.ReactNode;
  /** `compact` fits inside a card or tab; `standard` fills a page section. */
  size?: "compact" | "standard";
  /** Exposes the title as a heading of this level; leave unset when a heading would break the page outline. */
  headingLevel?: 2 | 3 | 4;
  /** Solid card surface instead of the default dashed outline. */
  solid?: boolean;
  className?: string;
}) {
  const compact = size === "compact";
  return <Empty data-size={size} className={cn("border", solid ? "border-solid bg-card" : "border-dashed", compact ? "gap-4 p-5 md:p-5" : "min-h-[240px] p-6 md:p-12", className)}>
    <EmptyHeader>
      {Icon && <EmptyMedia variant="icon"><Icon aria-hidden="true" /></EmptyMedia>}
      <EmptyTitle className={compact ? "text-sm font-semibold" : "text-base font-semibold"} {...(headingLevel ? { role: "heading", "aria-level": headingLevel } : {})}>{title}</EmptyTitle>
      {description && <EmptyDescription>{description}</EmptyDescription>}
    </EmptyHeader>
    {(action || secondary) && <EmptyContent className="flex-row flex-wrap justify-center gap-2">{action}{secondary}</EmptyContent>}
  </Empty>;
}
