import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { eventJoinLink, getEvent } from "@/server/events";
import { orNotFound, requireEvents, serverNow } from "@/server/event-page";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { EventForm } from "@/components/events/event-form";
import { fieldsOf } from "@/lib/event-form";
import type { EventItem } from "@/lib/event-view";

// C14: edit an event. The join link is read back with the manager preview, which the server only answers for owners and admins.
export default async function EditEventPage({ params }: { params: Promise<{ tenantId: string; eventId: string }> }) {
  requireEvents();
  const session = await pageSession(), { tenantId, eventId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "communities:manage")) return <AccessState />;
  const event = await orNotFound(getEvent(getDb(), session.user.id, tenantId, eventId)) as EventItem;
  const link = await eventJoinLink(getDb(), session.user.id, tenantId, eventId, true).catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; });
  return <EventForm tenantId={tenantId} eventId={eventId} initial={event} initialFields={fieldsOf(event, link?.url ?? "")} listHref={`/workspaces/${tenantId}/events`}
    rosterHref={`/workspaces/${tenantId}/events/${eventId}/roster`} now={serverNow()} />;
}
