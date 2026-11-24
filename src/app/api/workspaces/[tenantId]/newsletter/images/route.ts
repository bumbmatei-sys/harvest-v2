import { newsletterRoute } from "@/server/newsletter-route";
import { createNewsletterImageUpload, listNewsletterImages } from "@/server/newsletter-campaigns/images";
import { getFileStorage } from "@/server/storage";

export const runtime = "nodejs";
type Params = { tenantId: string };
export const GET = newsletterRoute<Params>(({ db, user, params }) => listNewsletterImages(db, user, params.tenantId), false);
export const POST = newsletterRoute<Params>(({ db, user, params, body }) => createNewsletterImageUpload(db, getFileStorage(user), user, params.tenantId, body), true);
