import { saveEmailFrequency } from "@/server/community-notifications";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
export const PUT = communityRoute<{ slug: string }>(({ db, user, params, body }) => saveEmailFrequency(db, user, params.slug, body), { write: true });
