import { respondToBioMessage, respondToBioProof } from "@/server/link-in-bio-public";

export const runtime = "nodejs";
export const GET = (request: Request, context: { params: Promise<{ handle: string }> }) => respondToBioProof(request, context);
export const POST = (request: Request, context: { params: Promise<{ handle: string }> }) => respondToBioMessage(request, context);
