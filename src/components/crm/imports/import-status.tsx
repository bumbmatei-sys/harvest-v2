import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ImportStatus = "draft" | "preview" | "running" | "completed" | "failed" | "rolled_back";
const tone: Record<ImportStatus, string> = {
  draft: "text-muted-foreground", preview: "text-muted-foreground", running: "bg-selected text-foreground",
  completed: "bg-success-tint text-success", failed: "bg-warning-tint text-warning", rolled_back: "text-muted-foreground",
};
/** Calm status chip for an import; the text always carries the meaning, colour only supports it. */
export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const t = useTranslations("Imports");
  return <Badge variant="secondary" className={cn("h-5 rounded-md px-1.5 text-[11px] font-normal", tone[status])}>{t(`statuses.${status}`)}</Badge>;
}
