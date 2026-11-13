import { markRead } from "@/server/community-notifications";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string }>(({ db, user, params, body }) => markRead(db, user, params.slug, body), { write: true });
