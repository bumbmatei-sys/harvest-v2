import { newsletterCollection, createTemplateRoute } from "@/server/newsletter-delivery/routes";

export const runtime = "nodejs";
export const GET = newsletterCollection("templates");
export const POST = createTemplateRoute;
