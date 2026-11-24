import { newsletterRoute } from "@/server/newsletter-route";
import { suggestVideoThumbnail } from "@/server/newsletter-campaigns/images";
import { getFileStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const POST = newsletterRoute<Params>(({ db, user, params, body }) => suggestVideoThumbnail(db, getFileStorage(user), user, params.tenantId, body), true);
