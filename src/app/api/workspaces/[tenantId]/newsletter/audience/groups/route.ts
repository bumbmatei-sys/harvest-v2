import { newsletterRoute } from "@/server/newsletter-route";
import { createGroupFromFilter } from "@/server/newsletter-audience";
export const runtime = "nodejs";
export const POST = newsletterRoute<{ tenantId: string }>(({ db, user, params, body }) => createGroupFromFilter(db, user, params.tenantId, body), true);
