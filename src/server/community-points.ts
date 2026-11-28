import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

const weight = z.number().int().min(0).max(1000);
const instant = z.iso.datetime({ offset: true });
const action = z.enum(["post", "reply", "lesson", "event"]);
const user = z.string().min(1).max(255);

export const pointSettings = z.object({
  enabled: z.boolean(),
  post: weight, reply: weight, lesson: weight, event: weight,
  thresholds: z.array(z.number().int().min(1).max(1_000_000)).max(20)
    .refine((values) => values.every((value, index) => index === 0 || value > values[index - 1])),
}).strict();

export const pointMutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), input: pointSettings }).strict(),
  z.object({ action: z.literal("create"), input: z.object({
    title: z.string().trim().min(1).max(120).regex(/^[^\x00-\x1f\x7f]+$/), startsAt: instant, endsAt: instant,
    goal: action, target: z.number().int().min(1).max(10000),
  }).strict().refine(({ startsAt, endsAt }) => Date.parse(endsAt) > Date.parse(startsAt)) }).strict(),
  z.object({ action: z.literal("join"), input: z.object({ challengeId: z.uuid() }).strict() }).strict(),
  z.object({ action: z.literal("attendance"), input: z.object({ userId: user, eventId: z.uuid(), attended: z.boolean() }).strict() }).strict(),
  z.object({ action: z.literal("hide"), input: z.object({ userId: user, hidden: z.boolean() }).strict() }).strict(),
]);

const pointPeriod = z.enum(["7", "30", "all"]).default("all");
type Report = {
  settings: z.infer<typeof pointSettings>;
  leaderboard: { userId: string; points: number; level: number }[];
  challenges: { id: string; title: string; startsAt: string; endsAt: string; goal: z.infer<typeof action>;
    target: number; joinedAt: string | null; completedAt: string | null; progress: number }[];
};
type Outcome<T> = ({ outcome: "ok" } & T) | { outcome: "not_found" | "invalid" };

async function operate<T extends object>(db: Database, actor: string, tenant: string, community: string, action: string, input: object): Promise<T> {
  if (!z.uuid().safeParse(tenant).success || !z.uuid().safeParse(community).success) {
    throw new AccessError(404, message("Errors.communityNotFound"));
  }
  return withUser(db, actor, async (tx) => {
    const { rows: [{ result }] } = await tx.execute<{ result: Outcome<T> }>(sql`
      select public.community_points(${tenant}::uuid, ${community}::uuid, ${action}, ${JSON.stringify(input)}::jsonb) as result`);
    if (result.outcome !== "ok") throw new AccessError(result.outcome === "not_found" ? 404 : 400, message("Errors.communityNotFound"));
    return result;
  });
}

export function readCommunityPoints(db: Database, actor: string, tenant: string, community: string, period: unknown) {
  return operate<Report>(db, actor, tenant, community, "read", { period: pointPeriod.parse(period) });
}

export function writeCommunityPoints(db: Database, actor: string, tenant: string, community: string, raw: unknown) {
  const { action, input } = pointMutation.parse(raw);
  return operate<{ id?: string }>(db, actor, tenant, community, action, input);
}
