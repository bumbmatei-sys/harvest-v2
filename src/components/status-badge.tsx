/** Derived from Shadcn UI Kit item badge1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 3). Visual reference only; local changes: docs/ui-sources.md. */
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { StatusTone } from "@/lib/status-tone";

/** Theme tokens only (see globals.css); a new palette changes every status at once. */
const toneClass: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-secondary text-secondary-foreground", dot: "bg-muted-foreground" },
  success: { badge: "bg-success-tint text-success", dot: "bg-success" },
  warning: { badge: "bg-warning-tint text-warning", dot: "bg-warning" },
  danger: { badge: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  info: { badge: "bg-selected text-foreground", dot: "bg-primary" },
  pending: { badge: "border-border bg-transparent text-muted-foreground", dot: "border border-current bg-transparent" },
};

/**
 * A short status label with a tone. The label is always visible text, so colour is never the only signal.
 * The caller supplies the label (catalogue) and the tone (see `defineStatusTones`); no domain strings live here.
 */
export function StatusBadge({ tone = "neutral", label, dot = false, className }: { tone?: StatusTone; label: string; dot?: boolean; className?: string }) {
  const classes = toneClass[tone];
  return <Badge variant="secondary" data-tone={tone} className={cn("h-5 max-w-full gap-1.5 rounded-md px-1.5 text-[11px] font-medium", classes.badge, className)}>
    {dot && <span aria-hidden="true" data-slot="status-dot" className={cn("inline-block size-1.5 shrink-0 rounded-full", classes.dot)} />}
    <span className="truncate">{label}</span>
  </Badge>;
}
