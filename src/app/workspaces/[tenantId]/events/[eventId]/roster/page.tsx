import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, Users } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getEvent, eventRoster } from "@/server/events";
import { listCommunities, listCommunityMembers } from "@/server/communities";
import { orNotFound, requireEvents } from "@/server/event-page";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { RosterTable } from "@/components/events/roster-table";
import type { EventItem } from "@/lib/event-view";

type Props = { params: Promise<{ tenantId: string; eventId: string }>; searchParams: Promise<{ after?: string }> };

// C14: who responded, for owners and admins. The server returns ids, responses and whether the seat is still valid; names come from the communities' member lists.
export default async function EventRosterPage({ params, searchParams }: Props) {
  requireEvents();
  const session = await pageSession(), { tenantId, eventId } = await params, { after } = await searchParams;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "communities:manage")) return <AccessState />;
  const event = await orNotFound(getEvent(db, session.user.id, tenantId, eventId)) as EventItem;
  const entries = await orNotFound(eventRoster(db, session.user.id, tenantId, eventId, after && after.length <= 255 ? after : null));
  const names = new Map<string, string>();
  for (const community of await listCommunities(db, session.user.id, tenantId)) for (const member of await listCommunityMembers(db, session.user.id, tenantId, community.id)) if (member.name.trim()) names.set(member.userId, member.name);
  const t = await getTranslations("Events"), back = `/workspaces/${tenantId}/events/${eventId}`;
  const next = entries.length === 100 ? `${back}/roster?after=${encodeURIComponent(entries[99].userId)}` : null;
  return <div className="min-w-0 space-y-6">
    <div className="space-y-3">
      <Link href={back} prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" aria-hidden="true" />{event.title}</Link>
      <div><Users className="mb-4 size-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-[28px] font-semibold tracking-tight">{t("rosterTitle")}</h1></div>
    </div>
    <RosterTable entries={entries.map((entry) => ({ ...entry, name: names.get(entry.userId) ?? "" }))} next={next} />
  </div>;
}
