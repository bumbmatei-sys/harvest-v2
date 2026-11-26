import { getGiveCoverUrl, setGiveCover } from "@/server/give-page";
import { fundraisingRoute } from "@/server/fundraising-route";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; fundraisingId: string };
// A short-lived signed address for the page's cover; choose or clear it with { fileId, version } (a stale version is a 409).
export const GET = fundraisingRoute<Params>((db, user, params) => getGiveCoverUrl(db, user, params, getStorage), "read");
export const PUT = fundraisingRoute<Params>(async (db, user, params, request) => setGiveCover(db, user, params, await request.json()), "write");
