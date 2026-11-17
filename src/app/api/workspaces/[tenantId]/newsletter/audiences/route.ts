import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { createNewsletterAudience, pageNewsletterConfiguration } from "@/server/newsletter";
export const GET = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, request }) => pageNewsletterConfiguration(db, user, params.tenantId, 'audiences', newsletterQuery(request)), false);
export const POST = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, body }) => createNewsletterAudience(db, user, params.tenantId, body), true);
