import { newsletterSignupCounts } from "@/server/newsletter-forms";
import { newsletterRoute } from "@/server/newsletter-route";
export const GET = newsletterRoute<{ tenantId: string; formId: string }>(({ db, user, params }) => newsletterSignupCounts(db, user, params.tenantId, params.formId), false);
