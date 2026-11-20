import { newsletterTestSendRoute } from "@/server/newsletter-delivery/routes";

export const runtime = "nodejs";
export const POST = newsletterTestSendRoute();
