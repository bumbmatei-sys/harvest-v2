import { decideHeld, heldItems } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const GET = communityRoute<{ slug: string }>(async ({ db, user, params }) => (await heldItems(db, user, params.slug)).items, { write: false });
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => decideHeld(db, user, params.slug, body), { write: true });
