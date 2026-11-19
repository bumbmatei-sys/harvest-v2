import { eventsRoute, rsvpEvent } from "@/server/events";

export const runtime = "nodejs";
export const PUT = eventsRoute<{ tenantId: string; eventId: string }>(({ db, user, params, body }) =>
  rsvpEvent(db, user, params.tenantId, params.eventId, body), { write: true });
