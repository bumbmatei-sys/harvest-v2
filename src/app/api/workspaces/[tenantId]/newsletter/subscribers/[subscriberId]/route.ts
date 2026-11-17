import { newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { updateNewsletterSubscriber } from "@/server/newsletter";
export const PATCH = newsletterRoute<{
    tenantId: string;
    subscriberId: string;
}>(({ db, user, params, body }) => updateNewsletterSubscriber(db, user, params.tenantId, params.subscriberId, body), true);
