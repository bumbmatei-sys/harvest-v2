import { newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { addNewsletterSubscriber } from "@/server/newsletter";
export const POST = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, body }) => addNewsletterSubscriber(db, user, params.tenantId, body), true);
