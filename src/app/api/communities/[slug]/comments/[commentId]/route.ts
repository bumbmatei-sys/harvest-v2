import { z } from "zod";
import { deleteComment, saveComment } from "@/server/community-forum";
import { communityRoute } from "@/server/community-route";
export const runtime = "nodejs";
type Params = { slug: string; commentId: string };
const edit = z.object({ postId: z.uuid(), body: z.string() }).strict();
export const PATCH = communityRoute<Params>(({ db, user, params, body }) => {
  const input = edit.parse(body);
  return saveComment(db, user, params.slug, input.postId, { body: input.body }, params.commentId);
}, { write: true });
export const DELETE = communityRoute<Params>(({ db, user, params }) => deleteComment(db, user, params.slug, params.commentId), { write: true });
