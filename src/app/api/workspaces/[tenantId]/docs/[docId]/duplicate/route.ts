import { docsRoute } from "@/server/docs-route";
import { duplicateDoc } from "@/server/docs";

export const POST = docsRoute<{ tenantId: string; docId: string }>(({ db, user, params }) => duplicateDoc(db, user, params.tenantId, params.docId), true);
