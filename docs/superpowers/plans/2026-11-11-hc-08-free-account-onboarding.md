# HC-08 Free-account onboarding and profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal Harvest account gets a one-time, skippable onboarding step (name, language, optional city, a path choice with three "Coming soon" options), a fuller profile page, and a `Finish setup` link, stored in a new owner-only `user_profiles` table.

**Architecture:** Migration 0034 adds `public.user_profiles` (one row per account, FORCE RLS, owner-only) and backfills every existing account as "skipped" so they are never prompted. `src/server/account-profile.ts` reads and writes the profile and derives onboarding status. The personal welcome page redirects accounts whose status is `pending` to `/account/onboarding`; the claim service and its many tests are untouched. One shared client form (`AccountProfileForm`) serves onboarding and profile.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl (`messages/en.json`), shadcn (Input, Select, RadioGroup, Badge, Button, Field, Alert), Drizzle + Postgres RLS (`withUser`), Vitest (unit, integration), Playwright + axe.

Spec: `docs/superpowers/specs/2026-11-11-hc-08-free-account-onboarding-design.md` (founder-approved design, with the redirect-on-welcome change recorded in Task 3).

## Global Constraints

- Table `public.user_profiles(user_id text primary key references users(id) on delete cascade, city_region text null check (length between 1 and 200), onboarding_completed_at timestamptz null, onboarding_skipped_at timestamptz null, updated_at timestamptz not null default now())`.
- FORCE RLS; `harvest_app` gets SELECT, INSERT, UPDATE only, restricted to `user_id = nullif(current_setting('app.user_id', true), '')`. No delete grant.
- Backfill existing accounts with `onboarding_skipped_at = now()` **before** RLS is enabled (FORCE RLS applies to the owner too).
- Display name stays in `users.name` (1–100 characters, trimmed); language in `users.locale`; city optional, 1–200 characters, trimmed. No religious-status field. No directory-visibility field. No consent switches.
- Path choice: all four options shown; only `Explore later` selectable; the other three disabled with a "Coming soon" badge; nothing about the choice is stored.
- Account pages stay `noindex`, `referrer: no-referrer`, `force-dynamic`, use `PublicFrame personal`, full width, 44px targets below `lg`.
- Copy is concise: no paragraph under fields; labels `Name`, `Language`, `City (optional)`. Provider-neutral wording. Organizations terminology unchanged; user-facing "ministry" wording unaffected.
- Production intake and invitation delivery stay hard-disabled; no real messages. No force pushes. No merge or deploy without the founder's explicit word.
- Next migration number is 0034 (0033 is the last on main).

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` (modify) | `userProfiles` table definition |
| `drizzle/0034_user_profiles.sql` + `drizzle/meta/*` (generate, then append) | Table, backfill, RLS, grants |
| `src/server/account-profile.ts` (create) | `getAccountProfile`, `saveOnboarding`, `skipOnboarding`, `updateAccountProfile`, `statusOf`, input schemas |
| `src/app/api/account/profile/route.ts` (create) | `PUT` profile update, sets/clears the `locale` cookie |
| `src/app/api/account/onboarding/route.ts` (create) | `POST` `{action:"save"|"skip"}` |
| `src/components/account-profile-form.tsx` (create) | Shared client form for onboarding and profile |
| `src/app/account/onboarding/page.tsx` (create) | Onboarding page |
| `src/app/account/profile/page.tsx` (modify) | Uses `AccountProfileForm` |
| `src/app/account/welcome/page.tsx` (modify) | Redirect when pending; `Finish setup` link when skipped |
| `messages/en.json` (modify) | New `AccountProfile` namespace |
| `tests/database.ts` (modify) | `beforeUserProfilesMigration` hook (after 0033) |
| `tests/integration/account-profile.test.ts` (create) | RLS, constraints, status, backfill |
| `tests/unit/migrations.test.ts`, `tests/unit/account-profile.test.ts` (modify/create) | Migration shape, input schema |
| `tests/e2e/account-onboarding.spec.ts` (create) | Full flow, a11y, screenshots |
| `tests/e2e/hc07-invitations.spec.ts`, `hc06b-association.spec.ts`, `hc06c-d-integrated.spec.ts` (modify) | Skip onboarding after a claim |
| `docs/acceptance/hc-08.md`, `docs/component-registry.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-11-11-hc-08-free-account-onboarding-design.md` (modify/create) | Records |

Local test setup (once per shell):

```bash
service postgresql start >/dev/null 2>&1
export TEST_DATABASE_URL=postgresql://postgres:local-ci-only@127.0.0.1:5432/harvest_test
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium
```

---

### Task 1: Data and server

**Files:**
- Modify: `src/db/schema.ts` (after the `users` table), `tests/database.ts`, `tests/unit/migrations.test.ts`
- Create: `drizzle/0034_user_profiles.sql` (generated), `src/server/account-profile.ts`, `tests/integration/account-profile.test.ts`, `tests/unit/account-profile.test.ts`

**Interfaces:**
- Produces:
  - `userProfiles` (Drizzle table, exported from `src/db/schema.ts`)
  - `type OnboardingStatus = "pending" | "completed" | "skipped"`
  - `type AccountProfile = { email: string; name: string; locale: string | null; cityRegion: string | null; onboarding: OnboardingStatus }`
  - `accountProfileInput` (zod, strict `{name, locale, cityRegion}`)
  - `getAccountProfile(db, userId): Promise<AccountProfile>`
  - `saveOnboarding(db, userId, raw): Promise<AccountProfile>` (sets completed)
  - `skipOnboarding(db, userId): Promise<AccountProfile>`
  - `updateAccountProfile(db, userId, raw): Promise<AccountProfile>` (does not change onboarding timestamps)

- [ ] **Step 1: Add the schema definition**

In `src/db/schema.ts`, after the `users` table, add (use the file's existing `pgTable`, `text`, `timestamp`, `check`, `sql` imports; add any that are missing):

```ts
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  cityRegion: text("city_region"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  onboardingSkippedAt: timestamp("onboarding_skipped_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("user_profile_city_region", sql`${t.cityRegion} is null or length(${t.cityRegion}) between 1 and 200`)]);
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name user_profiles`
Expected: creates `drizzle/0034_user_profiles.sql`, `drizzle/meta/0034_snapshot.json` and a journal entry `0034_user_profiles`. Check `git status` shows only those plus `schema.ts`.

- [ ] **Step 3: Append backfill, RLS and grants to the generated SQL**

Append to the end of `drizzle/0034_user_profiles.sql` (keep what drizzle-kit wrote above it; the backfill must come before `ENABLE`/`FORCE`):

```sql
--> statement-breakpoint
-- Accounts that exist when this migration runs count as already offered onboarding.
INSERT INTO public.user_profiles (user_id, onboarding_skipped_at) SELECT id, now() FROM public.users ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_profiles FROM PUBLIC, harvest_app;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO harvest_app;
CREATE POLICY user_profiles_owner ON public.user_profiles TO harvest_app
  USING (user_id = nullif(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), ''));
```

- [ ] **Step 4: Add the pre-migration test hook**

In `tests/database.ts`, add `beforeUserProfilesMigration?: (admin: Pool) => Promise<void>;` to the `testDatabase` options type (next to `beforeHc06bMigration`) and append `[33, options.beforeUserProfilesMigration]` to the seed list on the `for (const [lastIndex, seed] of [...]` line, so the entry list ends `..., [31, options.beforeHc06bMigration], [33, options.beforeUserProfilesMigration]] as const) {`.

- [ ] **Step 5: Write the failing integration test**

Create `tests/integration/account-profile.test.ts`:

```ts
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
  await f.db.insert(users).values(["p-a", "p-b", "p-c"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
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
  await expect(withUser(f.db, "p-b", (tx) => tx.insert(userProfiles).values({ userId: "p-a" }))).rejects.toThrow();
  expect((await f.admin.query("select city_region from user_profiles where user_id = 'p-a'")).rows[0]).toEqual({ city_region: "Berlin" });
});

it("gives the runtime role no delete right and removes the row with the account", async () => {
  await expect(withUser(f.db, "p-a", (tx) => tx.delete(userProfiles).where(eq(userProfiles.userId, "p-a")))).rejects.toThrow();
  await f.admin.query("delete from users where id = 'p-a'");
  expect((await f.admin.query("select 1 from user_profiles where user_id = 'p-a'")).rows).toEqual([]);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run --project integration tests/integration/account-profile.test.ts`
Expected: FAIL (`Cannot find module '../../src/server/account-profile'`).

- [ ] **Step 7: Implement the server module**

Create `src/server/account-profile.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { userProfiles, users } from "../db/schema";
import { locales } from "../i18n/locale";
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
  if (!row) throw new Error("Account not found.");
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
```

- [ ] **Step 8: Run the integration test to verify it passes**

Run: `npx vitest run --project integration tests/integration/account-profile.test.ts`
Expected: PASS (7 tests). If `sql\`coalesce(..., ${now})\`` fails to bind a Date, replace `${now}` with `${now.toISOString()}::timestamptz`.

- [ ] **Step 9: Add the unit tests**

Create `tests/unit/account-profile.test.ts`:

```ts
import { expect, it } from "vitest";
import { accountProfileInput, statusOf } from "../../src/server/account-profile";

it("derives onboarding status, completed winning over skipped", () => {
  const d = new Date();
  expect(statusOf(null, null)).toBe("pending");
  expect(statusOf(null, d)).toBe("skipped");
  expect(statusOf(d, d)).toBe("completed");
});
it("trims and bounds the profile input and rejects unknown keys", () => {
  expect(accountProfileInput.parse({ name: "  Ana ", locale: null, cityRegion: " Oslo " })).toEqual({ name: "Ana", locale: null, cityRegion: "Oslo" });
  expect(() => accountProfileInput.parse({ name: " ", locale: null, cityRegion: null })).toThrow();
  expect(() => accountProfileInput.parse({ name: "A", locale: null, cityRegion: "" })).toThrow();
  expect(() => accountProfileInput.parse({ name: "A", locale: null, cityRegion: null, religion: "x" })).toThrow();
});
```

In `tests/unit/migrations.test.ts`, directly after the 0033 assertion block, add (mirror the style of the 0033 block above it; `journal` and `snapshots` are already in scope):

```ts
  // HC-08: 0034 adds only the owner-only user_profiles table.
  const profilesIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0034_user_profiles");
  expect(profilesIndex).toBeGreaterThan(0);
  const profilesNew = Object.keys(snapshots[profilesIndex].tables).filter((name) => !(name in snapshots[profilesIndex - 1].tables));
  expect(profilesNew).toEqual(["public.user_profiles"]);
```

- [ ] **Step 10: Run unit tests, typecheck and lint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.ts drizzle tests/database.ts tests/unit tests/integration/account-profile.test.ts src/server/account-profile.ts
git commit -m "feat(hc-08): owner-only user_profiles table and account profile service (migration 0034)"
```

---

### Task 2: API routes

**Files:**
- Create: `src/app/api/account/profile/route.ts`, `src/app/api/account/onboarding/route.ts`
- Test: covered by the e2e spec in Task 4 plus a unit test for the onboarding body schema

**Interfaces:**
- Consumes: `getAccountProfile`, `saveOnboarding`, `skipOnboarding`, `updateAccountProfile` (Task 1); `errorResponse`, `verifiedUser`, `verifyOrigin` from `@/server/http`.
- Produces: `PUT /api/account/profile` (body `{name, locale, cityRegion}`) returns the `AccountProfile`; `POST /api/account/onboarding` (body `{action:"save", name, locale, cityRegion}` or `{action:"skip"}`) returns the `AccountProfile`.

- [ ] **Step 1: Create the profile route**

`src/app/api/account/profile/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { getAccountProfile, updateAccountProfile } from "@/server/account-profile";

const noStore = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { return Response.json(await getAccountProfile(getDb(), await verifiedUser(request)), { headers: noStore }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    verifyOrigin(request);
    const profile = await updateAccountProfile(getDb(), await verifiedUser(request), await request.json());
    const response = NextResponse.json(profile, { headers: noStore });
    if (profile.locale) response.cookies.set("locale", profile.locale, { path: "/", sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
    else response.cookies.delete("locale");
    return response;
  } catch (error) { return errorResponse(error); }
}
```

- [ ] **Step 2: Create the onboarding route**

`src/app/api/account/onboarding/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "@/server/http";
import { saveOnboarding, skipOnboarding } from "@/server/account-profile";

export const onboardingBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip") }).strict(),
  z.object({ action: z.literal("save"), name: z.string(), locale: z.string().nullable(), cityRegion: z.string().nullable() }).strict(),
]);
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const userId = await verifiedUser(request), body = onboardingBody.parse(await request.json());
    const profile = body.action === "skip"
      ? await skipOnboarding(getDb(), userId)
      : await saveOnboarding(getDb(), userId, { name: body.name, locale: body.locale, cityRegion: body.cityRegion });
    const response = NextResponse.json(profile, { headers: { "Cache-Control": "private, no-store" } });
    if (body.action === "save") {
      if (profile.locale) response.cookies.set("locale", profile.locale, { path: "/", sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 60 * 60 * 24 * 365 });
      else response.cookies.delete("locale");
    }
    return response;
  } catch (error) { return errorResponse(error); }
}
```

Note: Next route files may only export route handlers and config; if `next build` rejects the exported `onboardingBody`, make it a non-exported `const` and drop its use from tests.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/account
git commit -m "feat(hc-08): account profile and onboarding API routes"
```

---

### Task 3: Screens, copy and flow

**Files:**
- Create: `src/components/account-profile-form.tsx`, `src/app/account/onboarding/page.tsx`
- Modify: `src/app/account/profile/page.tsx`, `src/app/account/welcome/page.tsx`, `messages/en.json`
- Modify tests that land on the welcome page after a claim: `tests/e2e/hc07-invitations.spec.ts`, `tests/e2e/hc06b-association.spec.ts`, `tests/e2e/hc06c-d-integrated.spec.ts`

**Interfaces:**
- Consumes: `getAccountProfile`, `AccountProfile` (Task 1); the API routes (Task 2); `safeSourcePath` from `@/server/connect-invitations`; `PublicFrame`.
- Produces: `AccountProfileForm({ initial: { name, locale, cityRegion }, mode: "onboarding" | "profile", from?: string })`.

- [ ] **Step 1: Add the messages**

In `messages/en.json` add a top-level `AccountProfile` object (place it after `Profile`; keep valid JSON):

```json
"AccountProfile": {
  "onboardingTitle": "Set up your account",
  "name": "Name",
  "language": "Language",
  "automatic": "Use browser language",
  "city": "City (optional)",
  "firstStep": "What would you like to do first?",
  "findCommunity": "Find a free community",
  "bibleCourse": "Start a Bible course",
  "findChurch": "Find a church",
  "exploreLater": "Explore later",
  "comingSoon": "Coming soon",
  "saveContinue": "Save and continue",
  "skip": "Skip for now",
  "save": "Save profile",
  "saving": "Saving…",
  "saved": "Profile saved.",
  "saveFailed": "Could not save. Check your details and try again.",
  "connectionFailed": "Could not connect. Please try again.",
  "finishSetup": "Finish setup"
}
```

- [ ] **Step 2: Create the shared form**

`src/components/account-profile-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { locales, type Locale } from "@/i18n/locale";
import { useHydrated } from "@/hooks/use-hydrated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Initial = { name: string; locale: string | null; cityRegion: string | null };
const paths = [["explore_later", "exploreLater", true], ["find_community", "findCommunity", false], ["bible_course", "bibleCourse", false], ["find_church", "findChurch", false]] as const;

export function AccountProfileForm({ initial, mode, from }: { initial: Initial; mode: "onboarding" | "profile"; from?: string }) {
  const t = useTranslations("AccountProfile"), languages = useTranslations("Profile"), router = useRouter(), hydrated = useHydrated();
  const [name, setName] = useState(initial.name), [locale, setLocale] = useState(initial.locale ?? "auto"), [city, setCity] = useState(initial.cityRegion ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const welcome = `/account/welcome${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  const values = () => ({ name: name.trim(), locale: locale === "auto" ? null : locale, cityRegion: city.trim() || null });

  async function send(url: string, method: string, body: unknown, next?: string) {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401) { router.replace("/sign-in?personal=1"); return; }
      if (!response.ok) { setError(t("saveFailed")); return; }
      if (next) { router.replace(next); return; }
      setSaved(true); router.refresh();
    } catch { setError(t("connectionFailed")); }
    finally { setBusy(false); }
  }
  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "onboarding") void send("/api/account/onboarding", "POST", { action: "save", ...values() }, welcome);
    else void send("/api/account/profile", "PUT", values());
  }
  return <form onSubmit={submit} className="space-y-5">
    <Field><FieldLabel htmlFor="account-name">{t("name")}</FieldLabel>
      <Input id="account-name" className="min-h-11" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" required disabled={!hydrated || busy} /></Field>
    <Field><FieldLabel htmlFor="account-locale">{t("language")}</FieldLabel>
      <Select value={locale} onValueChange={setLocale} disabled={!hydrated || busy}>
        <SelectTrigger className="min-h-11" id="account-locale"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="auto">{t("automatic")}</SelectItem>{locales.map((code: Locale) => <SelectItem key={code} value={code}>{languages(`languages.${code}`)}</SelectItem>)}</SelectContent>
      </Select></Field>
    <Field><FieldLabel htmlFor="account-city">{t("city")}</FieldLabel>
      <Input id="account-city" className="min-h-11" value={city} onChange={(e) => setCity(e.target.value)} maxLength={200} autoComplete="address-level2" disabled={!hydrated || busy} /></Field>
    {mode === "onboarding" && <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t("firstStep")}</legend>
      <RadioGroup value="explore_later" aria-label={t("firstStep")}>
        {paths.map(([value, key, enabled]) => <label key={value} htmlFor={`path-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
          <RadioGroupItem id={`path-${value}`} value={value} disabled={!enabled} />
          <span className="flex-1">{t(key)}</span>
          {!enabled && <Badge variant="secondary">{t("comingSoon")}</Badge>}
        </label>)}
      </RadioGroup>
    </fieldset>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <Alert role="status"><AlertDescription>{t("saved")}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3">
      <Button className="min-h-11" disabled={!hydrated || busy || !name.trim()}>{t(busy ? "saving" : mode === "onboarding" ? "saveContinue" : "save")}</Button>
      {mode === "onboarding" && <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || busy} onClick={() => void send("/api/account/onboarding", "POST", { action: "skip" }, welcome)}>{t("skip")}</Button>}
    </div>
  </form>;
}
```

- [ ] **Step 3: Create the onboarding page**

`src/app/account/onboarding/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getAccountProfile } from "@/server/account-profile";
import { safeSourcePath } from "@/server/connect-invitations";
import { PublicFrame } from "@/components/connect/public-frame";
import { AccountProfileForm } from "@/components/account-profile-form";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function Onboarding({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await pageSession("personal"), profile = await getAccountProfile(getDb(), session.user.id), t = await getTranslations("AccountProfile");
  const source = safeSourcePath((await searchParams).from);
  return <PublicFrame personal><div className="mx-auto max-w-xl space-y-6"><h1 className="text-3xl font-semibold">{t("onboardingTitle")}</h1>
    <AccountProfileForm mode="onboarding" initial={{ name: profile.name, locale: profile.locale, cityRegion: profile.cityRegion }} from={source === "/resources/start" ? undefined : source} />
  </div></PublicFrame>;
}
```

- [ ] **Step 4: Switch the profile page to the shared form**

Replace `src/app/account/profile/page.tsx` with:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageSession } from "@/server/page-session";
import { getDb } from "@/db/client";
import { getAccountProfile } from "@/server/account-profile";
import { AccountProfileForm } from "@/components/account-profile-form";
import { PublicFrame } from "@/components/connect/public-frame";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function PersonalProfile() {
  const session = await pageSession("personal"), profile = await getAccountProfile(getDb(), session.user.id), t = await getTranslations("Invitations");
  return <PublicFrame personal><div className="space-y-6"><h1 className="text-3xl font-semibold">{t("profileTitle")}</h1><p>{profile.email}</p>
    <div className="max-w-xl"><AccountProfileForm mode="profile" initial={{ name: profile.name, locale: profile.locale, cityRegion: profile.cityRegion }} /></div>
    <Button asChild variant="outline" className="min-h-11"><Link href="/account/welcome">{t("accountHome")}</Link></Button></div></PublicFrame>;
}
```

- [ ] **Step 5: Redirect pending accounts from the welcome page and add the link**

In `src/app/account/welcome/page.tsx`: add imports `import { redirect } from "next/navigation";`, `import { getDb } from "@/db/client";`, `import { getAccountProfile } from "@/server/account-profile";`. Replace the first line of the component body (`await pageSession("personal");const t=...,source=...`) with:

```tsx
 const session=await pageSession("personal"),raw=(await searchParams).from,source=safeSourcePath(raw),profile=await getAccountProfile(getDb(),session.user.id);
 if(profile.onboarding==="pending")redirect(`/account/onboarding${source==="/resources/start"?"":`?from=${encodeURIComponent(source)}`}`);
 const t=await getTranslations("Invitations"),setup=await getTranslations("AccountProfile");
```

and, inside the button row before `<PersonalSignOut/>`, add the link (shown only when onboarding was skipped):

```tsx
{profile.onboarding==="skipped"&&<Button asChild variant="outline" className="min-h-11"><Link href={`/account/onboarding${source==="/resources/start"?"":`?from=${encodeURIComponent(source)}`}`}>{setup("finishSetup")}</Link></Button>}
```

Place it next to the existing `Link href="/connect/rights"` button so it sits in the same flex wrapper style (wrap both in the existing `flex flex-wrap gap-3` container if they are separate rows).

- [ ] **Step 6: Update the specs that claim an invitation and then expect the welcome page**

A new account is `pending`, so the welcome page now sends it to onboarding first. In each of the three specs, directly after the click that confirms the request, skip onboarding before the existing welcome assertion:

`tests/e2e/hc06b-association.spec.ts` line 39 — change `...click();await expect(visitor.getByRole("heading",{name:"Welcome to Harvest",exact:true})).toBeVisible();` to:
```ts
...click();await visitor.getByRole("button",{name:"Skip for now",exact:true}).click();await expect(visitor.getByRole("heading",{name:"Welcome to Harvest",exact:true})).toBeVisible();
```
`tests/e2e/hc07-invitations.spec.ts` line 58 and `tests/e2e/hc06c-d-integrated.spec.ts` line 69 — insert `await visitor.getByRole("button", { name: "Skip for now", exact: true }).click();` immediately before the `Welcome to Harvest` heading assertion (hc07's `from` return link is preserved because onboarding forwards `from`).

- [ ] **Step 7: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: pass. Fix any message-key lint errors (`scripts/check-source.ts`) by matching the existing key style.

- [ ] **Step 8: Commit**

```bash
git add src messages tests/e2e
git commit -m "feat(hc-08): onboarding page, shared account profile form and welcome redirect"
```

---

### Task 4: Browser spec, regression runs and evidence

**Files:**
- Create: `tests/e2e/account-onboarding.spec.ts`
- Modify: `docs/acceptance/hc-08.md` (create), `docs/component-registry.md`, `CLAUDE.md`, spec file (record the redirect decision)

- [ ] **Step 1: Write the browser spec**

`tests/e2e/account-onboarding.spec.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { origin, signIn } from "./helpers/session";

// HC-08: a new personal account is offered onboarding once, can skip it, and keeps editing its profile.
test.use({ actionTimeout: 30000, reducedMotion: "reduce" });
const evidence = "docs/screenshots/hc-08";
const sizes = [["phone", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 1000]] as const;

async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.waitForTimeout(300);
    for (const [label, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${label}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("a new account completes onboarding; another skips and can finish later", async ({ page, browser }) => {
  test.setTimeout(300000);
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);

  // Pending accounts are sent from the welcome page to onboarding.
  await page.goto("/account/welcome");
  await expect(page).toHaveURL(/\/account\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your account", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Explore later" })).toBeChecked();
  for (const label of ["Find a free community", "Start a Bible course", "Find a church"]) await expect(page.getByRole("radio", { name: new RegExp(label) })).toBeDisabled();
  await expect(page.getByText("Coming soon")).toHaveCount(3);
  await shoot(page, "onboarding");

  await page.getByLabel("Name", { exact: true }).fill("Maria Example");
  await page.getByLabel("City (optional)", { exact: true }).fill("Berlin");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/welcome$/);
  await expect(page.getByRole("heading", { name: "Welcome to Harvest", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Finish setup", exact: true })).toHaveCount(0);

  // The profile page shows the saved values and keeps saving without changing onboarding status.
  await page.goto("/account/profile");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Maria Example");
  await expect(page.getByLabel("City (optional)", { exact: true })).toHaveValue("Berlin");
  await page.getByLabel("City (optional)", { exact: true }).fill("Hamburg");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  await shoot(page, "profile");
  expect((await (await page.request.get("/api/account/profile")).json()).cityRegion).toBe("Hamburg");

  // Invalid input is refused by the API.
  expect((await page.request.put("/api/account/profile", { headers: { origin }, data: { name: "", locale: null, cityRegion: null } })).status()).toBeGreaterThanOrEqual(400);

  // A second account skips and sees "Finish setup" afterwards.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    const other = await context.newPage();
    await signIn(other);
    await other.goto("/account/welcome");
    await other.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(other.getByRole("heading", { name: "Welcome to Harvest", exact: true })).toBeVisible();
    await shoot(other, "welcome-skipped");
    await other.getByRole("link", { name: "Finish setup", exact: true }).click();
    await expect(other).toHaveURL(/\/account\/onboarding$/);
    // Skipping never blocks the free resources.
    await other.goto("/resources/start");
    await expect(other).toHaveURL(/\/resources\/start$/);
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npx playwright test tests/e2e/account-onboarding.spec.ts --trace off --reporter=list`
Expected: 1 passed. Open at least `docs/screenshots/hc-08/onboarding-phone-light.png`, `onboarding-desktop-dark.png` and `profile-tablet-light.png` with the image viewer and confirm: full-width layout, no clipped controls, the three "Coming soon" badges legible, 44px rows. If a locator for the disabled radios fails because the accessible name includes the badge text, use the `RegExp` form already shown.

- [ ] **Step 3: Run the regression specs**

Run: `npx playwright test tests/e2e/hc07-invitations.spec.ts tests/e2e/hc06b-association.spec.ts tests/e2e/hc06c-d-integrated.spec.ts --trace off --reporter=list`
Then: `git checkout -- docs/screenshots/hc-07 docs/screenshots/hc-06 2>/dev/null; git status --short`
Expected: all pass. The test runs overwrite committed screenshots of other features; restore them (keep only `docs/screenshots/hc-08/**`). If a spec still fails because it reaches `/account/welcome` another way, add the same `Skip for now` click.

- [ ] **Step 4: Run the full local gates**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:rls`
Expected: all pass (the integration suite includes `account-profile.test.ts` and the migration-count checks).

- [ ] **Step 5: Write the records**

- Create `docs/acceptance/hc-08.md`: what shipped (table, backfill, routes, screens), the founder decisions, validation actually run with the commands above, what is not covered (consent switches, directory visibility, real path destinations, production activation), and the gates (migration 0034 follows unapplied 0031–0033).
- `docs/component-registry.md`: add `AccountProfileForm` (shared by `/account/onboarding` and `/account/profile`).
- `CLAUDE.md`: add HC-08 to the state list as in-flight with migration 0034 and set 0035 as the next candidate after merge.
- Spec file: replace the "Claim completion" bullet with "The personal welcome page redirects accounts whose onboarding status is pending to `/account/onboarding` (keeping a safe `from` path); the claim service is unchanged", and change the welcome bullet to show `Finish setup` when status is `skipped`.

- [ ] **Step 6: Commit, push, open the draft PR**

```bash
git add -A docs CLAUDE.md tests
git commit -m "docs(hc-08): acceptance record, registry, state, browser evidence"
git push -u origin hc-08-onboarding
```
Open a **draft** PR titled `feat(hc-08): free-account onboarding and profile (migration 0034)` whose description states before/after, the files, the validation run, the not-run items, and the gates (no merge/deploy/production migration approved; 0031–0033 unapplied). Subscribe this session to the PR.

- [ ] **Step 7: CI and review**

1. Trigger the final review (`browser_review`, `build_pwa_review`) on the exact head as documented in `docs/setup/ci-final-review.md`.
2. This PR has a migration, so trigger the Neon check **from main** (`neon_only=true`, `expected_sha=<head>`, `pr_number=<PR>`). It is the first real run of that flow; record whether the `refs/heads/main` context rule matched, and report it to the founder before the old context rules are removed.
3. Start an independent review in a fresh session (read-only, exact head). Fix findings on the branch and ask for a delta re-review.
4. Report ready / blocked / next. Do not merge without the founder's word.

---

## Self-review (spec coverage)

- Table, constraints, RLS, no delete grant, cascade: Task 1 steps 1–3, 5, 8.
- Backfill so existing accounts are never prompted: Task 1 step 3, tested in step 5.
- Server functions and validation: Task 1 step 7; API: Task 2.
- Onboarding page, four path options with three disabled "Coming soon": Task 3 steps 2–3, Task 4 step 1.
- Profile page on the shared form: Task 3 step 4.
- Welcome redirect when pending, `Finish setup` when skipped, response-rights link retained: Task 3 step 5.
- Skip never blocks resources: Task 4 step 1 (`/resources/start`).
- Tests: integration (Task 1), unit (Task 1), browser with axe and screenshots (Task 4), regression specs (Task 3 step 6, Task 4 step 3).
- Records, PR, CI including the first Neon-from-main run, independent review: Task 4 steps 5–7.
- Type consistency: `AccountProfile`, `OnboardingStatus`, `accountProfileInput`, `getAccountProfile`, `saveOnboarding`, `skipOnboarding`, `updateAccountProfile`, `AccountProfileForm({ initial, mode, from })` are used with the same names everywhere.
