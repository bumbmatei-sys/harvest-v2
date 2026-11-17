import { newsletterQuery, newsletterRoute } from "@/server/newsletter-route";
export const runtime = "nodejs";
import { z } from "zod";
import { createNewsletterSegment, pageNewsletterConfiguration } from "@/server/newsletter";
export const GET = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, request }) => pageNewsletterConfiguration(db, user, params.tenantId, 'segments', newsletterQuery(request)), false);
export const POST = newsletterRoute<{
    tenantId: string;
}>(({ db, user, params, body }) => { const { audienceId, ...input } = z.object({ audienceId: z.uuid(), name: z.string(), savedViewId: z.uuid() }).strict().parse(body); return createNewsletterSegment(db, user, params.tenantId, audienceId, input); }, true);
