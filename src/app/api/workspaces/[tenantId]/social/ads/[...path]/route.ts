import { adsResponse } from "@/server/ads/http";

type Context = { params: Promise<{ tenantId: string; path: string[] }> };
export const runtime = "nodejs";
// Hard-off: every method answers the neutral 404 while ADS_INTEGRATION_ENABLED is false (outside the non-production test gate). Owner and admin only.
export const GET = (request: Request, context: Context) => adsResponse(request, context);
export const POST = GET;
export const PATCH = GET;
export const DELETE = GET;
