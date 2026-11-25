import { docsFileRoute, docsQuery } from "@/server/docs-route";
import { exportDoc } from "@/server/docs-io";

export const GET = docsFileRoute<{ tenantId: string; docId: string }>(({ db, user, params, request }) => exportDoc(db, user, params.tenantId, params.docId, docsQuery(request)));
