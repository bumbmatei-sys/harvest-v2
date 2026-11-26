import { getGivePage, saveGivePage } from "@/server/give-page";
import { fundraisingRoute } from "@/server/fundraising-route";

// The fundraiser's public page settings (owners and admins): { slug, description, showAmount, version? }. 404 while the module is off.
export const GET = fundraisingRoute<{ tenantId: string; fundraisingId: string }>((db, user, { tenantId, fundraisingId }) => getGivePage(db, user, tenantId, fundraisingId), "read");
export const PUT = fundraisingRoute<{ tenantId: string; fundraisingId: string }>(async (db, user, { tenantId, fundraisingId }, request) =>
  saveGivePage(db, user, tenantId, fundraisingId, await request.json()), "write");
