import { createNewsletterSignupForm } from "@/server/newsletter-public";
import { newsletterRoute } from "@/server/newsletter-route";
export const POST = newsletterRoute<{ tenantId: string }>(({ db, user, params, body }) =>
  createNewsletterSignupForm(db, user, params.tenantId, body), true);
