import { z } from "zod";
import { docsQuery, docsRoute } from "@/server/docs-route";
import { createComment, listThreads } from "@/server/docs-comments";

type Params = { tenantId: string; docId: string };
export const GET = docsRoute<Params>(({ db, user, params, request }) => listThreads(db, user, params.tenantId, params.docId, z.uuid().parse(docsQuery(request).pageId)), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => { const { pageId, ...rest } = z.object({ pageId: z.uuid() }).passthrough().parse(body); return createComment(db, user, params.tenantId, params.docId, pageId, rest); }, true);
