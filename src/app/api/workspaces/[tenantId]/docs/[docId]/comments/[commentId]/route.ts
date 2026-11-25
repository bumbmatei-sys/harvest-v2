import { docsRoute } from "@/server/docs-route";
import { deleteComment, updateThread } from "@/server/docs-comments";

type Params = { tenantId: string; docId: string; commentId: string };
export const PATCH = docsRoute<Params>(({ db, user, params, body }) => updateThread(db, user, params.tenantId, params.docId, params.commentId, body), true);
export const DELETE = docsRoute<Params>(({ db, user, params }) => deleteComment(db, user, params.tenantId, params.docId, params.commentId), true);
