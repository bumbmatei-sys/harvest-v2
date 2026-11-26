import { confirmGiveCoverUpload } from "@/server/give-page";
import { fundraisingRoute } from "@/server/fundraising-route";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const POST = fundraisingRoute<{ tenantId: string; fundraisingId: string; fileId: string }>((db, user, params) =>
  confirmGiveCoverUpload(db, user, params, params.fileId, getStorage), "write");
