import { docsRoute } from "@/server/docs-route";
import { importIntoDoc } from "@/server/docs-io";

export const POST = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params, body }) => importIntoDoc(db, user, params.tenantId, params.docId, body), true);
