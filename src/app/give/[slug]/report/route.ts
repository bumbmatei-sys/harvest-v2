import { respondToGiveReport } from "@/server/give-page-public";

export const runtime = "nodejs";
export const POST = (request: Request, context: { params: Promise<{ slug: string }> }) => respondToGiveReport(request, context);
