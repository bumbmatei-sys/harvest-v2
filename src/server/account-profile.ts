import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { userProfiles, users } from "../db/schema";
import { locales } from "../i18n/locale";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

export type OnboardingStatus = "pending" | "completed" | "skipped";
export type AccountProfile = { email: string; name: string; locale: string | null; cityRegion: string | null; onboarding: OnboardingStatus };

const bounded = (max: number) => z.string().trim().min(1).max(max);
export const accountProfileInput = z.object({
  name: bounded(100),
  locale: z.enum(locales).nullable(),
  cityRegion: bounded(200).nullable(),
}).strict();

export const statusOf = (completedAt: Date | null, skippedAt: Date | null): OnboardingStatus =>
  completedAt ? "completed" : skippedAt ? "skipped" : "pending";

async function read(tx: Transaction, userId: string): Promise<AccountProfile> {
  const [row] = await tx.select({
    email: users.email, name: users.name, locale: users.locale, cityRegion: userProfiles.cityRegion,
    completedAt: userProfiles.onboardingCompletedAt, skippedAt: userProfiles.onboardingSkippedAt,
  }).from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, userId));
  if (!row) throw new AccessError(404, message("Errors.accountNotFound"));
  return { email: row.email, name: row.name, locale: row.locale, cityRegion: row.cityRegion ?? null, onboarding: statusOf(row.completedAt ?? null, row.skippedAt ?? null) };
}

async function write(tx: Transaction, userId: string, raw: unknown, complete: boolean) {
  const input = accountProfileInput.parse(raw), now = new Date();
  await tx.update(users).set({ name: input.name, locale: input.locale, updatedAt: now }).where(eq(users.id, userId));
  const stamp = complete ? { onboardingCompletedAt: now } : {};
  await tx.insert(userProfiles).values({ userId, cityRegion: input.cityRegion, updatedAt: now, ...stamp })
    .onConflictDoUpdate({ target: userProfiles.userId, set: { cityRegion: input.cityRegion, updatedAt: now, ...stamp } });
}

export function getAccountProfile(db: Database, userId: string) {
  return withUser(db, userId, (tx) => read(tx, userId));
}
export function saveOnboarding(db: Database, userId: string, raw: unknown) {
  return withUser(db, userId, async (tx) => { await write(tx, userId, raw, true); return read(tx, userId); });
}
export function updateAccountProfile(db: Database, userId: string, raw: unknown) {
  return withUser(db, userId, async (tx) => { await write(tx, userId, raw, false); return read(tx, userId); });
}
export function skipOnboarding(db: Database, userId: string) {
  return withUser(db, userId, async (tx) => {
    const now = new Date();
    await tx.insert(userProfiles).values({ userId, onboardingSkippedAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: userProfiles.userId, set: { onboardingSkippedAt: sql`coalesce(${userProfiles.onboardingSkippedAt}, ${now})`, updatedAt: now } });
    return read(tx, userId);
  });
}
