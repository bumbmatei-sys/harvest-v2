import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { testDatabase } from "../database";
import { userProfiles, users } from "../../src/db/schema";
import { withUser } from "../../src/server/tenancy";
import { getAccountProfile, saveOnboarding, skipOnboarding, updateAccountProfile } from "../../src/server/account-profile";

// HC-08: a personal account's profile is private to its owner; existing accounts are backfilled as skipped.
let f: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  f = await testDatabase({
    beforeUserProfilesMigration: async (admin) => {
      await admin.query("insert into users (id, name, email, email_verified) values ('old-1', 'Old One', 'old-1@example.test', true)");
    },
  });
  await f.db.insert(users).values(["p-a", "p-b", "p-c", "p-d"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
});
afterAll(async () => { await f?.close(); });

it("backfills pre-existing accounts as skipped and leaves new accounts pending", async () => {
  expect((await getAccountProfile(f.db, "old-1")).onboarding).toBe("skipped");
  expect((await getAccountProfile(f.db, "p-a")).onboarding).toBe("pending");
});

it("saves onboarding: name, language, city, and marks it completed", async () => {
  const saved = await saveOnboarding(f.db, "p-a", { name: "  Maria  ", locale: "en", cityRegion: " Berlin " });
  expect(saved).toMatchObject({ name: "Maria", locale: "en", cityRegion: "Berlin", onboarding: "completed" });
  expect((await f.admin.query("select name, locale from users where id = 'p-a'")).rows[0]).toEqual({ name: "Maria", locale: "en" });
});

it("skips onboarding without touching the profile, and a completed account stays completed", async () => {
  expect((await skipOnboarding(f.db, "p-b")).onboarding).toBe("skipped");
  const first = (await f.admin.query("select onboarding_skipped_at from user_profiles where user_id = 'p-b'")).rows[0].onboarding_skipped_at;
  await skipOnboarding(f.db, "p-b");
  expect((await f.admin.query("select onboarding_skipped_at from user_profiles where user_id = 'p-b'")).rows[0].onboarding_skipped_at).toEqual(first);
  expect((await skipOnboarding(f.db, "p-a")).onboarding).toBe("completed");
});

it("updates the profile without changing onboarding status", async () => {
  const before = await getAccountProfile(f.db, "p-c");
  const updated = await updateAccountProfile(f.db, "p-c", { name: "Chris", locale: null, cityRegion: null });
  expect(before.onboarding).toBe("pending");
  expect(updated).toMatchObject({ name: "Chris", locale: null, cityRegion: null, onboarding: "pending" });
});

it("rejects invalid input in the service and in the database", async () => {
  await expect(saveOnboarding(f.db, "p-a", { name: "", locale: null, cityRegion: null })).rejects.toThrow();
  await expect(saveOnboarding(f.db, "p-a", { name: "x".repeat(101), locale: null, cityRegion: null })).rejects.toThrow();
  await expect(saveOnboarding(f.db, "p-a", { name: "Ok", locale: "xx", cityRegion: null })).rejects.toThrow();
  await expect(saveOnboarding(f.db, "p-a", { name: "Ok", locale: null, cityRegion: "y".repeat(201) })).rejects.toThrow();
  await expect(saveOnboarding(f.db, "p-a", { name: "Ok", locale: null, cityRegion: null, extra: 1 })).rejects.toThrow();
  await expect(f.admin.query("update user_profiles set city_region = '' where user_id = 'p-a'")).rejects.toThrow(/user_profile_city_region/);
});

it("lets a person read and write only their own row", async () => {
  expect(await withUser(f.db, "p-b", (tx) => tx.select().from(userProfiles).where(eq(userProfiles.userId, "p-a")))).toEqual([]);
  expect(await withUser(f.db, "p-b", (tx) => tx.update(userProfiles).set({ cityRegion: "Hijack" }).where(eq(userProfiles.userId, "p-a")).returning())).toEqual([]);
  // p-d has no row yet, so only the policy's WITH CHECK (not the primary key) can stop this insert.
  await expect(withUser(f.db, "p-b", (tx) => tx.insert(userProfiles).values({ userId: "p-d" }))).rejects.toMatchObject({ cause: { code: "42501" } });
  expect((await f.admin.query("select 1 from user_profiles where user_id = 'p-d'")).rows).toEqual([]);
  expect((await f.admin.query("select city_region from user_profiles where user_id = 'p-a'")).rows[0]).toEqual({ city_region: "Berlin" });
});

it("gives the runtime role no delete right and removes the row with the account", async () => {
  await expect(withUser(f.db, "p-a", (tx) => tx.delete(userProfiles).where(eq(userProfiles.userId, "p-a")))).rejects.toThrow();
  await f.admin.query("delete from users where id = 'p-a'");
  expect((await f.admin.query("select 1 from user_profiles where user_id = 'p-a'")).rows).toEqual([]);
});
