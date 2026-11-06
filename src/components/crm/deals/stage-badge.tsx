import { cn } from "@/lib/utils";
import type { StageColor } from "@/lib/crm-deals";
import { Badge } from "@/components/ui/badge";

/** Stage colours are theme tokens, never raw values. */
export const stageDot: Record<StageColor, string> = {
  neutral: "bg-muted-foreground", primary: "bg-primary", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive",
};
export function StageDot({ color, className }: { color: StageColor; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", stageDot[color], className)} />;
}
export function StageBadge({ name, color }: { name: string; color: StageColor }) {
  return <Badge variant="secondary" className="h-5 max-w-full gap-1.5 rounded-md px-1.5 text-[11px] font-normal"><StageDot color={color} /><span className="truncate">{name}</span></Badge>;
}
/** Calm stale marker: open deals whose expected close date has passed. */
export function StaleBadge({ label }: { label: string }) {
  return <Badge variant="secondary" className="h-5 shrink-0 rounded-md bg-warning-tint px-1.5 text-[11px] font-normal text-warning">{label}</Badge>;
}
