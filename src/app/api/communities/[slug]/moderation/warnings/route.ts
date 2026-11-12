import { warnMember } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
// C12b: a host warns a lower-ranked member (rank rules and the reason limits are enforced by the definer).
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => warnMember(db, user, params.slug, body), { write: true });
