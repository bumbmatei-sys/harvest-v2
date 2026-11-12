import { decideReport } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string; reportId: string }>(({ db, user, params, body }) => decideReport(db, user, params.slug, params.reportId, body), { write: true });
