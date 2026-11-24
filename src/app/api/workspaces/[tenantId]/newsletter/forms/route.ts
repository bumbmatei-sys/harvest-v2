import { createNewsletterSignupFormDraft, listNewsletterSignupForms } from "@/server/newsletter-forms";
import { newsletterRoute } from "@/server/newsletter-route";
export const GET = newsletterRoute<{ tenantId: string }>(async ({ db, user, params }) => ({ forms: await listNewsletterSignupForms(db, user, params.tenantId) }), false);
export const POST = newsletterRoute<{ tenantId: string }>(({ db, user, params, body }) => createNewsletterSignupFormDraft(db, user, params.tenantId, body), true);
