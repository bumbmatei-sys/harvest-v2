import { communityRoute } from "@/server/community-route";
import { harvestReportResponse, submitContentHarvestReport } from "@/server/community-takedown";

export const runtime = "nodejs";
// A member reports a post or reply to Harvest staff (not to the community's hosts).
export const POST = communityRoute<{ slug: string }>(async ({ db, user, params, body }) => harvestReportResponse(await submitContentHarvestReport(db, user, params.slug, body)), { write: true });
