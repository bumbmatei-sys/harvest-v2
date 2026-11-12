import { moderateMember, moderationMembers } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const GET = communityRoute<{ slug: string }>(async ({ db, user, params }) => (await moderationMembers(db, user, params.slug)).members, { write: false });
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => moderateMember(db, user, params.slug, body), { write: true });
