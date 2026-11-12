import { submitAppeal } from "@/server/community-moderation";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
// C12b: a banned member appeals (body: { slug, message }). One appeal per ban; the definer checks the ban.
export const POST = communityRoute<Record<string, string>>(({ db, user, body }) => submitAppeal(db, user, body), { write: true });
