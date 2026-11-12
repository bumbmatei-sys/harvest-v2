import { moderationQueue } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const GET = communityRoute<{ slug: string }>(async ({ db, user, params }) => (await moderationQueue(db, user, params.slug)).items, { write: false });
