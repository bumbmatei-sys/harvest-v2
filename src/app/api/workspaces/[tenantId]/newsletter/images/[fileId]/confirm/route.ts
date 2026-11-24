import { newsletterRoute } from "@/server/newsletter-route";
import { confirmNewsletterImageUpload } from "@/server/newsletter-campaigns/images";
import { getFileStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string; fileId: string };
export const POST = newsletterRoute<Params>(({ db, user, params }) => confirmNewsletterImageUpload(db, getFileStorage(user), user, params.tenantId, params.fileId), true);
