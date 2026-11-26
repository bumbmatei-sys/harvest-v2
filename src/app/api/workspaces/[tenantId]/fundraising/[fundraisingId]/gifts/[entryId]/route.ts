import { fundraisingRoute, idempotencyHeader } from "@/server/fundraising-route";
import { correctGift } from "@/server/fundraising";

type Params = { tenantId: string; fundraisingId: string; entryId: string };
/** Appends a reversal (and an optional replacement gift). Body: { reason, replacementCents?, replacementDate?, confirmed: true }. */
export const POST = fundraisingRoute<Params>(async (db, user, { tenantId, fundraisingId, entryId }, request) =>
  correctGift(db, user, tenantId, fundraisingId, entryId, await request.json(), idempotencyHeader(request)), "write");
