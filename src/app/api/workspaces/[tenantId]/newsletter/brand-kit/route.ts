import { newsletterRoute } from "@/server/newsletter-route";
import { getBrandKit, saveBrandKit } from "@/server/newsletter-campaigns/brand-kit";

type Params = { tenantId: string };

export const GET = newsletterRoute<Params>(({ db, user, params }) => getBrandKit(db, user, params.tenantId), false);
export const PUT = newsletterRoute<Params>(({ db, user, params, body }) => saveBrandKit(db, user, params.tenantId, body), true);
