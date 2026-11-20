import { newsletterCollection, createSenderRoute } from "@/server/newsletter-delivery/routes";

export const runtime = "nodejs";
export const GET = newsletterCollection("senders");
export const POST = createSenderRoute;
