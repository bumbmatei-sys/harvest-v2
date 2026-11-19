import { eventsRoute, setEventPlacement } from "@/server/events";

export const runtime = "nodejs";
type Params = { tenantId: string; eventId: string; communityId: string };
export const PUT = eventsRoute<Params>(({ db, user, params }) =>
  setEventPlacement(db, user, params.tenantId, params.eventId, params.communityId, true), { write: true });
export const DELETE = eventsRoute<Params>(({ db, user, params }) =>
  setEventPlacement(db, user, params.tenantId, params.eventId, params.communityId, false), { write: true });
