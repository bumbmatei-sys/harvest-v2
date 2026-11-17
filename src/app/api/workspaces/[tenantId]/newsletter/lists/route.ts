import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { z } from "zod";
import { createNewsletterList, pageNewsletterConfiguration } from "@/server/newsletter";
export const GET = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, request }) => pageNewsletterConfiguration(db, user, params.tenantId, 'lists', newsletterQuery(request)), false);
export const POST = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, body }) => { const { audienceId, ...input } = z.object({ audienceId: z.uuid(), name: z.string() }).strict().parse(body); return createNewsletterList(db, user, params.tenantId, audienceId, input); }, true);
