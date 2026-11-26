import { createGiveCoverUpload } from "@/server/give-page";
import { fundraisingRoute } from "@/server/fundraising-route";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const POST = fundraisingRoute<{ tenantId: string; fundraisingId: string }>(async (db, user, params, request) =>
  createGiveCoverUpload(db, user, params, await request.json(), getStorage), "write");
