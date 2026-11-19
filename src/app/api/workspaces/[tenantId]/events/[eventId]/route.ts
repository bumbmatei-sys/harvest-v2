import { eventsRoute, getEvent, saveEvent, transitionEvent } from "@/server/events";

export const runtime = "nodejs";
type Params = { tenantId: string; eventId: string };
export const GET = eventsRoute<Params>(({ db, user, params }) => getEvent(db, user, params.tenantId, params.eventId), { write: false });
export const PUT = eventsRoute<Params>(({ db, user, params, body }) => saveEvent(db, user, params.tenantId, params.eventId, body), { write: true });
export const PATCH = eventsRoute<Params>(({ db, user, params, body }) => transitionEvent(db, user, params.tenantId, params.eventId, body), { write: true });
