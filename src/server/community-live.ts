import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { liveCommentsModes, liveStates, parseLiveVideoUrl } from "../lib/community-live";
import { message } from "../i18n/messages";
import { communitySlug } from "./communities";
import { communityRoute } from "./community-route";
import { communitiesEnabled } from "./communities-mode";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

/** L1 is synthetic/local only; the existing community enable flag cannot activate Live in production. */
export function communityLiveEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && communitiesEnabled(env);
}
function enabled() { if (!communityLiveEnabled()) throw new AccessError(404, message("Errors.communityNotFound")); }
export const liveEventInput = z.object({
  title: z.string().trim().min(1).max(120),
  videoUrl: z.string().max(2048).refine((s) => parseLiveVideoUrl(s) !== null),
  scheduledStart: z.iso.datetime({ offset: true }), scheduledEnd: z.iso.datetime({ offset: true }).nullable().default(null),
  state: z.enum(liveStates).default("draft"), commentsMode: z.enum(liveCommentsModes).default("held"),
  version: z.number().int().min(0),
}).strict().refine((v) => !v.scheduledEnd || new Date(v.scheduledEnd) > new Date(v.scheduledStart));
function dbCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } }; return e?.cause?.code ?? e?.code;
}
/** Full replacement with version; create uses version 0, schedule/end/replay use the same guarded transition. */
export async function saveLiveEvent(db: Database, userId: string, slug: string, eventId: string | null, raw: unknown) {
  enabled(); const input = liveEventInput.parse(raw), id = eventId === null ? null : z.uuid().parse(eventId);
  try {
    return await withUser(db, userId, async (tx) => (await tx.execute(sql`select public.community_live_save(${communitySlug.parse(slug)},${id}::uuid,${input.version}::integer,
      ${input.title},${parseLiveVideoUrl(input.videoUrl)},${input.scheduledStart}::timestamptz,${input.scheduledEnd}::timestamptz,${input.state},${input.commentsMode}) as event`)).rows[0].event);
  } catch (e) {
    const code = dbCode(e);
    if (code === "40001") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
    if (code === "42501" || code === "P0002") throw new AccessError(404, message("Errors.communityNotFound"));
    if (code === "22023") throw new AccessError(400, message("Errors.thisRecordChangedReloadAndTryAgain"));
    throw e;
  }
}
export function listLiveEvents(db: Database, userId: string, slug: string, eventId?: string) {
  enabled(); const parsedSlug = communitySlug.parse(slug), id = eventId ? z.uuid().parse(eventId) : undefined;
  return withUser(db, userId, async (tx) => {
    const rows = (await tx.execute<{ events: Record<string, unknown>[] }>(sql`select public.community_live_list(${parsedSlug},${id ?? null}::uuid) as events`)).rows[0].events;
    if (id && !rows.length) throw new AccessError(404,message("Errors.communityNotFound"));
    return rows;
  });
}
export function autoCloseLiveEvents(db: Database, userId: string, slug: string) {
  enabled(); return withUser(db,userId,async (tx) => (await tx.execute<{ closed: number }>(sql`select public.community_live_auto_close(${communitySlug.parse(slug)}) as closed`)).rows[0].closed);
}

/** Gate before authentication and DB creation, including when the existing Communities flag is enabled. */
export function communityLiveRoute<P>(run: Parameters<typeof communityRoute<P>>[0], options: { write: boolean }) {
  const route = communityRoute(run,options);
  return (request: Request, context: { params: Promise<P> }) => communityLiveEnabled() ? route(request,context) : Promise.resolve(new Response(null,{ status:404 }));
}
