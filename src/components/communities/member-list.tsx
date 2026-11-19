/** Derived from Shadcn UI Kit item tables9 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 7). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Search, ShieldCheck, UserCog, Users } from "lucide-react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { filterMembers, isStaffRole, memberInitials, memberStatusTone, statusTabs } from "@/lib/community-members";

export type MemberListItem = { id: string; name: string; role: string; status?: string; joinedAt?: string | null; action?: React.ReactNode;
  /** Link to the member's profile page; the name becomes a link (44px target) when set. */ href?: string };
const roleIcon = { owner: ShieldCheck, admin: ShieldCheck, moderator: UserCog } as const;

/**
 * Members with roles. Owner and admin view: name, role, status, status tabs and search. Member view: names and roles only, with the
 * joined date and an optional action slot (report). Which members and fields appear is decided by the server; this only lays them out.
 */
export function MemberList({ label, members, audience, unnamedLabel }: { label: string; members: MemberListItem[]; audience: "manage" | "member"; unnamedLabel: string }) {
  const t = useTranslations("CommunityScreens.members"), roles = useTranslations("CommunityEditor.roles"), statuses = useTranslations("CommunityEditor.memberStatuses"), format = useFormatter();
  const profile = useTranslations("CommunityProfile"), profileOf = (name: string) => profile("viewProfileOf", { name }), manage = audience === "manage", [query, setQuery] = useState(""), [status, setStatus] = useState("all");
  const tabs = manage ? statusTabs(members) : [];
  const shown = filterMembers(members, query).filter((member) => status === "all" || member.status === status);
  const columns: DataTableColumn[] = [
    { id: "name", header: t("name"), card: "title" }, { id: "role", header: t("role") },
    ...(manage ? [{ id: "status", header: t("status"), showFrom: "@md" as const }] : [{ id: "joined", header: t("joined"), showFrom: "@lg" as const }]),
    ...(!manage && members.some((member) => member.action) ? [{ id: "action", header: t("actions"), srOnlyHeader: true, align: "end" as const, card: "actions" as const }] : []),
  ];
  const rows: DataTableRow[] = shown.map((member) => {
    const name = member.name.trim() || unnamedLabel, Icon = roleIcon[member.role as keyof typeof roleIcon];
    return { id: member.id, label: name, cells: {
      // In a narrow table container (the editor beside its preview) the status column is hidden and the badge moves under the name.
      name: <span className="flex min-w-0 items-center gap-3"><Avatar size="default"><AvatarFallback aria-hidden="true">{memberInitials(member.name)}</AvatarFallback></Avatar>
        <span className="flex min-w-0 flex-col items-start gap-1">{member.href ? <Link href={member.href} prefetch={false} aria-label={profileOf(name)} className="flex min-h-11 min-w-0 items-center break-words font-medium hover:underline">{name}</Link> : <span className="min-w-0 break-words font-medium">{name}</span>}
          {member.status && <span className="@md:hidden group-data-[layout=cards]/results:hidden"><StatusBadge tone={memberStatusTone(member.status)} label={statuses(member.status as "active")} /></span>}</span></span>,
      role: <Badge variant={isStaffRole(member.role) ? "secondary" : "outline"} className="gap-1">{Icon && <Icon aria-hidden="true" />}{roles(member.role as "owner")}</Badge>,
      status: member.status ? <StatusBadge tone={memberStatusTone(member.status)} label={statuses(member.status as "active")} /> : null,
      joined: member.joinedAt ? format.dateTime(new Date(member.joinedAt), { dateStyle: "medium" }) : null,
      action: member.action,
    } };
  });
  return <DataTable label={label} columns={columns} rows={rows}
    toolbar={manage ? { search: <InputGroup className="min-h-11 lg:min-h-9"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={(event) => setQuery(event.target.value)} /></InputGroup> } : undefined}
    tabs={manage && tabs.length > 2 ? { label: t("statusTabs"), value: status, onValueChange: setStatus, items: tabs.map((tab) => ({ value: tab.value, label: tab.value === "all" ? t("all") : statuses(tab.value as "active"), count: tab.count })) } : undefined}
    empty={<EmptyState icon={Users} title={t(manage ? "emptyManage" : "empty")} size="compact" />} />;
}
