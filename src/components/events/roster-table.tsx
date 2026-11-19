import Link from "next/link";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { defineStatusTones } from "@/lib/status-tone";
import type { EventState } from "@/lib/event-view";

const tone = defineStatusTones({ going: "success", maybe: "neutral", not_going: "neutral", waitlisted: "warning" });
export type RosterEntry = { userId: string; name: string; state: EventState; eligible: boolean };

/** Responses to one event: name, response and whether the seat is still valid (a member who left or lost access shows as lapsed). Cards on phones. */
export function RosterTable({ entries, next }: { entries: RosterEntry[]; next: string | null }) {
  const t = useTranslations("Events");
  const columns: DataTableColumn[] = [
    { id: "name", header: t("rosterName"), card: "title" }, { id: "state", header: t("rosterResponse") }, { id: "seat", header: t("rosterSeat") },
  ];
  const rows: DataTableRow[] = entries.map((entry) => ({ id: entry.userId, label: entry.name || t("unnamed"), cells: {
    name: <span className="font-medium">{entry.name || t("unnamed")}</span>,
    state: <StatusBadge tone={tone(entry.state)} label={t(`rsvp.${entry.state}`)} />,
    seat: t(entry.eligible ? "seatActive" : "seatLapsed"),
  } }));
  return <div className="space-y-4">
    <DataTable label={t("rosterTitle")} columns={columns} rows={rows} empty={<EmptyState icon={Users} title={t("rosterEmpty")} />} />
    {next && <Button asChild variant="outline" className="min-h-11"><Link href={next} prefetch={false}>{t("rosterNext")}</Link></Button>}
  </div>;
}
