import { dmChangeMessage, dmRoute } from "@/server/community-dm";

type Params = { slug: string; messageId: string };
export const PATCH = dmRoute<Params>(async ({ db, user, params, body }) =>
  dmChangeMessage(db, user, params.slug, params.messageId, "edit", body), true);
export const DELETE = dmRoute<Params>(async ({ db, user, params }) =>
  dmChangeMessage(db, user, params.slug, params.messageId, "delete"), true);
