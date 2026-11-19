import { chatChannelSelection, chatResponse, communityChatRoute } from "@/server/community-chat";

type Params = { slug: string; channelId: string };
export const GET = communityChatRoute<Params>(async ({ db, user, params, request }) => {
  const query = new URL(request.url).searchParams;
  return chatResponse(await chatChannelSelection(db, user, params.slug, params.channelId, query.get("thread"), query.get("before")));
}, { write: false });
