import { communityEmailFeedback, COMMUNITY_EMAIL_FEEDBACK_ENABLED } from "@/server/community-email-feedback";
import { communitiesEnabled } from "@/server/communities-mode";

export const runtime = "nodejs";
export function POST(request: Request) {
  if (!communitiesEnabled()) return new Response(null, { status: 404 });
  if (!COMMUNITY_EMAIL_FEEDBACK_ENABLED) return new Response(null, { status: 404 });
  return communityEmailFeedback(request);
}
