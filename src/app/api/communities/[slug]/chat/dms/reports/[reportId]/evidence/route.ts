import { dmEvidence, dmRoute } from "@/server/community-dm";

type Params = { slug: string; reportId: string };
export const POST = dmRoute<Params>(async ({ db, user, params }) =>
  dmEvidence(db, user, params.slug, params.reportId), true);
