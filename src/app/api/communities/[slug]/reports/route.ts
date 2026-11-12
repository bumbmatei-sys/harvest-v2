import { reportContent } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => reportContent(db, user, params.slug, body), { write: true });
