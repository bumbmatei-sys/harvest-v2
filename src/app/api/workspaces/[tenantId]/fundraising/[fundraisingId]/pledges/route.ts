import { fundraisingRoute, idempotencyHeader } from "@/server/fundraising-route";
import { listPledges, recordPledge } from "@/server/fundraising";

type Params = { tenantId: string; fundraisingId: string };
export const GET = fundraisingRoute<Params>((db, user, { tenantId, fundraisingId }) => listPledges(db, user, tenantId, fundraisingId), "read");
export const POST = fundraisingRoute<Params>(async (db, user, { tenantId, fundraisingId }, request) =>
  recordPledge(db, user, tenantId, fundraisingId, await request.json(), idempotencyHeader(request)), "write");
