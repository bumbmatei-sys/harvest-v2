import { updateNewsletterSignupForm } from "@/server/newsletter-public";
import { newsletterRoute } from "@/server/newsletter-route";
export const PATCH = newsletterRoute<{ tenantId: string; formId: string }>(({ db, user, params, body }) =>
  updateNewsletterSignupForm(db, user, params.tenantId, params.formId, body), true);
