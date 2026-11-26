import { newsletterRoute } from "@/server/newsletter-route";
import { newsletterClickSettings, saveNewsletterClickSettings } from "@/server/newsletter-clicks";

type Params = { tenantId: string };

// Newsletter settings: link-click counting (off by default). Owners and admins read it; only the owner changes it.
export const GET = newsletterRoute<Params>(({ db, user, params }) => newsletterClickSettings(db, user, params.tenantId), false);
export const PUT = newsletterRoute<Params>(({ db, user, params, body }) => saveNewsletterClickSettings(db, user, params.tenantId, body), true);
