"use client";
import Link from "next/link";
import { joinParts } from "@/lib/social/join";
import { CalendarPlus, Copy, FileText, PenLine } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import type { ConnectionView, DraftSummary } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";

/**
 * The unscheduled drafts. In the planner each draft can be dragged onto a day or hour of the calendar; the Schedule button is the keyboard and
 * touch alternative. Opening a draft goes back to Compose; Duplicate makes a new draft from it.
 */
export function DraftsPanel({ tenantId, drafts, connections, draggable, onSchedule, onDuplicate, busyId }: {
  tenantId: string; drafts: readonly DraftSummary[]; connections: readonly ConnectionView[]; draggable?: boolean; busyId?: string | null;
  onSchedule?: (draft: DraftSummary) => void; onDuplicate: (draft: DraftSummary) => void;
}) {
  const t = useTranslations("SocialPublish.drafts"), locale = useLocale();
  if (drafts.length === 0) return <EmptyState icon={FileText} title={t("empty")} size="compact" />;
  const names = (draft: DraftSummary) => draft.connectionIds.flatMap((id) => { const connection = connections.find((item) => item.id === id); return connection ? [platformLabels[connection.platform]] : []; });
  return <ul className="m-0 list-none space-y-2 p-0" data-testid="drafts-list">
    {drafts.map((draft) => <li key={draft.id} data-testid="draft-item" draggable={draggable} className="space-y-2 rounded-lg border bg-card p-3"
      onDragStart={(event) => { event.dataTransfer.setData("application/x-harvest-draft", JSON.stringify({ id: draft.id, version: draft.version })); event.dataTransfer.effectAllowed = "move"; }}>
      <p className="line-clamp-2 text-sm font-medium">{draft.summary || t("untitled")}</p>
      <p className="text-xs text-muted-foreground">{joinParts([names(draft).join(", ") || t("noAccounts"), new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.updatedAt))])}</p>
      <div className="flex flex-wrap gap-1">
        <Button asChild variant="outline" size="responsive"><Link href={`/workspaces/${tenantId}/social/compose?draft=${draft.id}`} prefetch={false}><PenLine aria-hidden="true" />{t("open")}</Link></Button>
        {onSchedule && <Button type="button" variant="outline" size="responsive" disabled={busyId === draft.id} onClick={() => onSchedule(draft)}><CalendarPlus aria-hidden="true" />{t("schedule")}</Button>}
        <Button type="button" variant="ghost" size="responsive" disabled={busyId === draft.id} onClick={() => onDuplicate(draft)}><Copy aria-hidden="true" />{t("duplicate")}</Button>
      </div>
    </li>)}
  </ul>;
}
