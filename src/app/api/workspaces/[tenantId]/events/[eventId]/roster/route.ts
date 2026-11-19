import { eventRoster, eventsRoute } from "@/server/events";

export const runtime = "nodejs";
export const GET = eventsRoute<{ tenantId: string; eventId: string }>(({ db, user, params, request }) =>
  eventRoster(db, user, params.tenantId, params.eventId, new URL(request.url).searchParams.get("after")), { write: false });
