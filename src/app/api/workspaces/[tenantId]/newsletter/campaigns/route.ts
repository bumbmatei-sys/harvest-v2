import { newsletterCollection, createCampaignRoute } from "@/server/newsletter-delivery/routes";

export const runtime = "nodejs";
export const GET = newsletterCollection("campaigns");
export const POST = createCampaignRoute;
