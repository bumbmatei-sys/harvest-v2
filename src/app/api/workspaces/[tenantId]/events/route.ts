import { eventsRoute, listEvents } from "@/server/events";

export const runtime = "nodejs";
export const GET = eventsRoute<{ tenantId: string }>(({ db, user, params, request }) => {
  const query = new URL(request.url).searchParams;
  return listEvents(db, user, params.tenantId, { from: query.get("from"), to: query.get("to") });
}, { write: false });
