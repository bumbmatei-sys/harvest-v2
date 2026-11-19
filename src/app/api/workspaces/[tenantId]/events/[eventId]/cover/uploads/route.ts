import { eventsRoute } from "@/server/events";
import { createEventCoverUpload } from "@/server/event-covers";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; eventId: string };
export const POST = eventsRoute<Params>(({ db, user, params, body }) =>
  createEventCoverUpload(db, user, params, body, getStorage), { write: true });
