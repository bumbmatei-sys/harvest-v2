import { eventsRoute } from "@/server/events";
import { getEventCoverUrl, setEventCover } from "@/server/event-covers";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; eventId: string };
export const GET = eventsRoute<Params>(({ db, user, params }) => getEventCoverUrl(db, user, params, getStorage), { write: false });
export const PUT = eventsRoute<Params>(({ db, user, params, body }) => setEventCover(db, user, params, body), { write: true });
