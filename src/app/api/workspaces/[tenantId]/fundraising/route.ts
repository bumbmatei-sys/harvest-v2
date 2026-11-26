import { fundraisingRoute, idempotencyHeader } from "@/server/fundraising-route";
import { createFundraising, listFundraising } from "@/server/fundraising";

type Params = { tenantId: string };
export const GET = fundraisingRoute<Params>((db, user, { tenantId }) => listFundraising(db, user, tenantId), "read");
export const POST = fundraisingRoute<Params>(async (db, user, { tenantId }, request) => createFundraising(db, user, tenantId, await request.json(), idempotencyHeader(request)), "write");
