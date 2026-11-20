import { eventsRoute } from "@/server/events";
import { confirmEventCoverUpload } from "@/server/event-covers";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; eventId: string; fileId: string };
export const POST = eventsRoute<Params>(({ db, user, params }) =>
  confirmEventCoverUpload(db, user, params, params.fileId, getStorage), { write: true });
