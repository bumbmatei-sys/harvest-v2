import { newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { setNewsletterSubscription } from "@/server/newsletter";
export const PUT = newsletterRoute<{
    tenantId: string;
    listId: string;
    subscriberId: string;
}>(({ db, user, params, body }) => setNewsletterSubscription(db, user, params.tenantId, params.listId, params.subscriberId, body), true);
