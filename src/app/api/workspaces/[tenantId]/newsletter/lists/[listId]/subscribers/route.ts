import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { listNewsletterSubscribers } from "@/server/newsletter";
export const GET = newsletterRoute<{
    tenantId: string;
    listId: string;
}>(({ db, user, params, request }) => listNewsletterSubscribers(db, user, params.tenantId, params.listId, newsletterQuery(request)), false);
