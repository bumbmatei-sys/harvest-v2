import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { message } from "../i18n/messages";
import { communitiesEnabled } from "./communities-mode";
import { communitySlug } from "./communities";
import { communityRoute } from "./community-route";
import type { DirectoryMember } from "./community-forum";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

export const profileVisibilities = ["members", "unlisted", "private"] as const;
export type ProfileFields = {
  displayName: string | null;
  bio: string | null;
  language: string | null;
  links: { label: string; url: string }[];
  visibility: typeof profileVisibilities[number];
};
export type ProfileProjection = { member: DirectoryMember; profile: ProfileFields };
type SelfProfile = ProfileFields & { version: number };
type SelfOutcome = { outcome: "ok"; data: SelfProfile } | { outcome: "not_found" | "invalid" | "conflict" };
type SelfAction = "get" | "save" | "withdraw" | "erase";

const notFound = () => new AccessError(404, message("Errors.communityNotFound"));
const userId = z.string().min(1).max(200).refine((value) => !value.includes("\u0000"));
const plainText = (value: string) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const text = (limit: number) => z.string().trim().min(1).max(limit).refine(plainText);
const versionInput = z.object({ version: z.number().int().min(0).max(2147483646) }).strict();
const url = z.string().max(2048).refine((value) => {
  if (!value.startsWith("https://") || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !value.slice(8).split(/[/?#]/, 1)[0].includes("@");
  } catch {
    return false;
  }
});
const saveInput = versionInput.extend({
  displayName: text(100).nullable().default(null),
  bio: z.string().trim().max(500).refine(plainText).nullable().default(null),
  language: text(80).nullable().default(null),
  links: z.array(z.object({ label: text(40), url }).strict()).max(3).default([]),
  visibility: z.enum(profileVisibilities).default("members"),
});

export function memberProfilesEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && communitiesEnabled(env);
}

function address(slug: string) {
  const parsed = communitySlug.safeParse(slug);
  if (!memberProfilesEnabled() || !parsed.success) throw notFound();
  return parsed.data;
}

export async function readMemberProfileTx(tx: Transaction, slug: string, target: string) {
  const safeSlug = address(slug);
  const id = userId.safeParse(target);
  if (!id.success) throw notFound();
  const { rows: [row] } = await tx.execute<{ value: ProfileProjection | null }>(
    sql`select public.community_member_profile_read(${safeSlug}, ${id.data}) as value`);
  if (!row?.value) throw notFound();
  return row.value;
}

export function readCommunityProfile(db: Database, actor: string, slug: string, target: string) {
  address(slug);
  return withUser(db, actor, (tx) => readMemberProfileTx(tx, slug, target));
}

export async function ownCommunityProfile(db: Database, actor: string, slug: string, action: SelfAction, raw?: unknown) {
  const safeSlug = address(slug);
  const fields = action === "save" ? saveInput.parse(raw) : null;
  const version = fields?.version ?? (action === "get" ? null : versionInput.parse(raw).version);
  const result = await withUser(db, actor, async (tx) => (await tx.execute<{ value: SelfOutcome }>(sql`
    select public.community_member_profile_self(${safeSlug}, ${action}, ${version}::int,
      ${fields?.displayName ?? null}, ${fields?.bio ?? null}, ${fields?.language ?? null},
      ${fields ? JSON.stringify(fields.links) : null}::jsonb, ${fields?.visibility ?? null}) as value`)).rows[0].value);
  if (result.outcome === "ok") return result.data;
  if (result.outcome === "invalid") throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  if (result.outcome === "conflict") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
  throw notFound();
}

export function memberProfileRoute<P>(run: Parameters<typeof communityRoute<P>>[0], write: boolean) {
  const route = communityRoute(run, { write });
  return (request: Request, context: { params: Promise<P> }) => memberProfilesEnabled()
    ? route(request, context)
    : Promise.resolve(new Response(null, { status: 404 }));
}
