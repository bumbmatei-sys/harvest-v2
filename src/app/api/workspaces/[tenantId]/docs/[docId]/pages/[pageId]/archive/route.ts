import { z } from "zod";
import { docsRoute } from "@/server/docs-route";
import { archivePage } from "@/server/docs";

export const POST = docsRoute<{ tenantId: string; docId: string; pageId: string }>(({ db, user, params, body }) =>
  archivePage(db, user, params.tenantId, params.docId, params.pageId, z.object({ archived: z.boolean() }).strict().parse(body).archived), true);
