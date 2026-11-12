import { acknowledgeWarning } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
// C12b: the warned member acknowledges their own warning (the definer checks ownership).
export const POST = communityRoute<{ slug: string; warningId: string }>(({ db, user, params }) => acknowledgeWarning(db, user, params.slug, params.warningId), { write: true });
