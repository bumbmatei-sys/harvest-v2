import { newsletterPublicInfo, newsletterPublicPost } from "@/server/newsletter-public-route";
export const runtime = "nodejs";
export const GET = () => newsletterPublicInfo("signup");
export const POST = (request: Request) => newsletterPublicPost(request, "signup");
