import { newsletterCallback } from "@/server/newsletter-campaigns/callback";
export const POST = (request: Request) => newsletterCallback(request);
