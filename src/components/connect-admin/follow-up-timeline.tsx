/** Derived from Shadcn UI Kit item chat-ui4 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 6). Visual reference only; local changes: docs/ui-sources.md. */
import { getFormatter, getTranslations } from "next-intl/server";
import { CircleDot, ListPlus, UserRoundCheck } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { followUpTone, type CaseEvent } from "@/lib/follow-up-ui";

const icons = { opened: ListPlus, assigned: UserRoundCheck, state: CircleDot } as const;

/**
 * The events a case record proves (opened, last assigned, last state change), oldest first, on a rail like a thread. The case keeps no
 * history and no notes, so this is not a log and offers no composer; it shows only timestamps the API returned.
 */
export async function FollowUpTimeline({ events, assignee }: { events: CaseEvent[]; assignee: string | null }) {
  const t = await getTranslations("FollowUp");
  const format = await getFormatter();
  return <ol aria-label={t("timelineLabel")} className="space-y-5">
    {events.map((event) => {
      const Icon = icons[event.kind];
      return <li key={`${event.kind}-${event.at.toISOString()}`} className="relative flex gap-3 ps-0">
        <span aria-hidden="true" className="relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground"><Icon className="size-3.5" /></span>
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">{t(`events.${event.kind}`, { name: assignee ?? "" })}
            {event.kind === "state" && event.state && <StatusBadge tone={followUpTone(event.state)} label={t(`states.${event.state}`)} />}</p>
          <time dateTime={event.at.toISOString()} className="text-xs text-muted-foreground">{format.dateTime(event.at, "dateTime")}</time>
        </div>
      </li>;
    })}
  </ol>;
}
