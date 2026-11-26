import { respondToBioGivingReport } from "@/server/link-in-bio-public";

export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ handle: string }> }) => respondToBioGivingReport(request, context);
