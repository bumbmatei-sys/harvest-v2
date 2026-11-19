import { newsletterPublicPost } from "@/server/newsletter-public-route";
export const runtime = "nodejs";
export const POST = (request: Request) => newsletterPublicPost(request, "confirm");
