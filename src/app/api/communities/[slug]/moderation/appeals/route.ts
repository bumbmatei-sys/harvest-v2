import { decideAppeal, moderationAppeals } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
// C12b: hosts list and decide appeals by banned members. Non-hosts get the neutral 404.
export const GET = communityRoute<{ slug: string }>(async ({ db, user, params }) => (await moderationAppeals(db, user, params.slug)).items, { write: false });
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => decideAppeal(db, user, params.slug, body), { write: true });
