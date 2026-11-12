import { listNotifications } from "@/server/community-notifications";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
// C15a: the bell's list (own notifications plus unseen announcements).
export const GET = communityRoute<{ slug: string }>(({ db, user, params }) => listNotifications(db, user, params.slug), { write: false });
