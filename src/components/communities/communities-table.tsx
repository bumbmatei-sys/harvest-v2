"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MessagesSquare } from "lucide-react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { defineStatusTones } from "@/lib/status-tone";

const communityTone = defineStatusTones({ published: "success", draft: "neutral", archived: "pending" });
export type CommunityListItem = { id: string; name: string; status: "draft" | "published" | "archived"; visibility: "listed" | "unlisted" | "hidden" };

/** The ministry's communities, as a table (cards on phones). Data and permissions come from the page. */
export function CommunitiesTable({ tenantId, communities, manage }: { tenantId: string; communities: CommunityListItem[]; manage: boolean }) {
  const t = useTranslations("CommunitiesPage");
  const columns: DataTableColumn[] = [
    { id: "name", header: t("name"), card: "title" }, { id: "status", header: t("status") }, { id: "visibility", header: t("visibility") },
  ];
  const rows: DataTableRow[] = communities.map((community) => ({ id: community.id, label: community.name, cells: {
    name: <Link className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline lg:min-h-0" href={`/workspaces/${tenantId}/communities/${community.id}/edit`}>{community.name}</Link>,
    status: <StatusBadge tone={communityTone(community.status)} label={t(`statuses.${community.status}`)} />,
    visibility: t(`visibilities.${community.visibility}`),
  } }));
  return <DataTable label={t("title")} columns={columns} rows={rows}
    empty={<EmptyState icon={MessagesSquare} title={t(manage ? "emptyManage" : "empty")} />} />;
}
