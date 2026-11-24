import { docsRoute } from "@/server/docs-route";
import { attachFile, listAttachments } from "@/server/docs-io";

type Params = { tenantId: string; docId: string };
export const GET = docsRoute<Params>(({ db, user, params }) => listAttachments(db, user, params.tenantId, params.docId), false);
export const POST = docsRoute<Params>(({ db, user, params, body }) => attachFile(db, user, params.tenantId, params.docId, body), true);
