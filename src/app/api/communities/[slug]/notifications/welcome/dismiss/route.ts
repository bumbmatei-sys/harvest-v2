import { dismissWelcome } from "@/server/community-notifications";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const POST = communityRoute<{ slug: string }>(({ db, user, params }) => dismissWelcome(db, user, params.slug), { write: true });
