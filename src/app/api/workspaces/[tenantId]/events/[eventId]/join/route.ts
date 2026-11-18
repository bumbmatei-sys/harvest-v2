import { eventJoinLink, eventsRoute } from "@/server/events";

export const runtime = "nodejs";
type Params = { tenantId: string; eventId: string };
export const POST = eventsRoute<Params>(({ db, user, params, request }) =>
  eventJoinLink(db, user, params.tenantId, params.eventId, new URL(request.url).searchParams.get("preview") === "1"), { write: true });
