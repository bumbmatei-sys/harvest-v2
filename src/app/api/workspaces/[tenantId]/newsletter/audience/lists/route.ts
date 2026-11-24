import { newsletterRoute } from "@/server/newsletter-route";
import { createAudienceList } from "@/server/newsletter-audience";
export const runtime = "nodejs";
export const POST = newsletterRoute<{ tenantId: string }>(({ db, user, params, body }) => createAudienceList(db, user, params.tenantId, body), true);
