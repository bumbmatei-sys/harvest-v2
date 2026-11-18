import { downloadEvent, eventsRoute } from "@/server/events";

export const runtime = "nodejs";
export const GET = eventsRoute<{ tenantId: string; eventId: string }>(({ db, user, params }) =>
  downloadEvent(db, user, params.tenantId, params.eventId), { write: false });
