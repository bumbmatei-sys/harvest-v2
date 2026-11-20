import { newsletterCallbackRoute } from "@/server/newsletter-delivery/callback-route";

export const runtime = "nodejs";
export const POST = newsletterCallbackRoute();
