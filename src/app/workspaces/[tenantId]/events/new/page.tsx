import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireEvents, serverNow } from "@/server/event-page";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { EventForm } from "@/components/events/event-form";
import { emptyFields } from "@/lib/event-form";

// C14: a new event. The id is made here so that a retried save is the same event, not a second one.
export default async function NewEventPage({ params }: { params: Promise<{ tenantId: string }> }) {
  requireEvents();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "communities:manage")) return <AccessState />;
  const now = serverNow(), fields = emptyFields("UTC", new Date(now));
  return <EventForm tenantId={tenantId} eventId={randomUUID()} initial={null} initialFields={fields} listHref={`/workspaces/${tenantId}/events`} rosterHref={null} now={now} />;
}
