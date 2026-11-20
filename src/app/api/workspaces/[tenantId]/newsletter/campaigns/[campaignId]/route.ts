import { getCampaignRoute, saveCampaignRoute } from "@/server/newsletter-delivery/routes";

export const runtime = "nodejs";
export const GET = getCampaignRoute;
export const PATCH = saveCampaignRoute;
