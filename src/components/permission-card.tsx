/** Derived from Shadcn UI Kit item switch-card1 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 6). Visual reference only; local changes: docs/ui-sources.md. */
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import type { StatusTone } from "@/lib/status-tone";

/**
 * One permission or consent choice as a bordered card: a label, its current state as a badge (text, never colour alone), an optional
 * one-line description and meta line, and a slot for the actions the viewer may take. Display only: the state is a badge, not a switch,
 * because a consent is changed by recording a new event, never by flipping a control. The caller supplies all text and decides which
 * actions to pass; nothing here knows a permission.
 */
export function PermissionCard({ label, status, description, meta, actions, as: Tag = "div", className }: {
  label: string; status: { tone: StatusTone; label: string }; description?: string; meta?: string; actions?: React.ReactNode;
  /** `li` when the cards sit in a list. */
  as?: "div" | "li"; className?: string;
}) {
  return <Tag data-slot="permission-card" className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-lg border bg-card p-4", className)}>
    <div className="min-w-0 flex-1 basis-48 space-y-0.5">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{label}<StatusBadge tone={status.tone} label={status.label} /></p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {meta && <p className="text-xs [overflow-wrap:anywhere] text-muted-foreground">{meta}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </Tag>;
}
