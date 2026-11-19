import { newsletterPublicInfo, newsletterPublicPost } from "@/server/newsletter-public-route";
export const runtime = "nodejs";
export const GET = () => newsletterPublicInfo("unsubscribe");
export const POST = (request: Request) => newsletterPublicPost(request, "unsubscribe");
