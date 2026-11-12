import { moderationHistory } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const GET = communityRoute<{ slug: string }>(async ({ db, user, params }) => (await moderationHistory(db, user, params.slug)).entries, { write: false });
