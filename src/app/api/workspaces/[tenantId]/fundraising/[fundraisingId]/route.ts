import { fundraisingRoute } from "@/server/fundraising-route";
import { getFundraising, updateFundraising } from "@/server/fundraising";

type Params = { tenantId: string; fundraisingId: string };
export const GET = fundraisingRoute<Params>((db, user, { tenantId, fundraisingId }) => getFundraising(db, user, tenantId, fundraisingId), "read");
/** Body: { version, title?, summary?, goalCents?, currency?, action?: "open" | "close" | "archive" }. */
export const PATCH = fundraisingRoute<Params>(async (db, user, { tenantId, fundraisingId }, request) => updateFundraising(db, user, tenantId, fundraisingId, await request.json()), "write");
