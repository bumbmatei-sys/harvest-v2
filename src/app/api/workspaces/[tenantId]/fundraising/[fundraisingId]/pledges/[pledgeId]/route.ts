import { fundraisingRoute } from "@/server/fundraising-route";
import { updatePledge } from "@/server/fundraising";

type Params = { tenantId: string; fundraisingId: string; pledgeId: string };
/** Body: { version, action: "accept" | "cancel" }. */
export const PATCH = fundraisingRoute<Params>(async (db, user, { tenantId, fundraisingId, pledgeId }, request) =>
  updatePledge(db, user, tenantId, fundraisingId, pledgeId, await request.json()), "write");
