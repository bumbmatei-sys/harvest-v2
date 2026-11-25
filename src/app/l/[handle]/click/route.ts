import { respondToBioClick } from "@/server/link-in-bio-public";

export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ handle: string }> }) => respondToBioClick(request, context);
