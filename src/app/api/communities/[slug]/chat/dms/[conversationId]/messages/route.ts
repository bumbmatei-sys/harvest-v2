import { dmMessages, dmRoute, dmSend } from "@/server/community-dm";

type Params = { slug: string; conversationId: string };
export const GET = dmRoute<Params>(async ({ db, user, params, request }) =>
  dmMessages(db, user, params.slug, params.conversationId, new URL(request.url).searchParams, request.headers.get("if-none-match")), false);
export const POST = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmSend(db, user, params.slug, params.conversationId, body), true);
