import { blogRoute } from "@/server/blog-route";
import { getBlog, saveBlogSettings } from "@/server/blog";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = blogRoute<Params>(({ db, user, params }) => getBlog(db, user, params.tenantId), false);
export const PUT = blogRoute<Params>(({ db, user, params, body }) => saveBlogSettings(db, user, params.tenantId, body), true);
