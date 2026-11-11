# Communities PR 3 (C05 + C06 + C08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public community pages, communities-only Discover, open joining with optional rules plus an 18+ confirmation, and personal invitation links, all behind the Communities flag.

**Architecture:**
- **Data:** migration 0036 adds community fields, membership acceptance fields, `community_invites` and the `discover_listings` projection. All are FORCE RLS with staff policies only.
- **Public and member access:** anonymous visitors and members go through three `SECURITY DEFINER` functions: `community_public`, `community_enter`, `discover_communities`. A fourth, `community_my_invites`, serves the account page. Following the HC-03 pattern, the migration owner gets owner-only row policies keyed on definer-local GUCs, so it works without BYPASSRLS.
- **Owner services:** they run in `withTenant` and keep the projection in the same transaction.

**Tech Stack:** Next.js App Router, React 19, next-intl, shadcn/ui, Drizzle + Postgres FORCE RLS, Vitest (unit/integration), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-11-communities-pr3-public-join-invites-design.md`

## Global Constraints

- **Branch and migration:** branch `c05-public-join-invites`. Migration `0036_community_joining` follows `0035_communities` in `drizzle/meta/_journal.json`. Never renumber.
- **Flag:** everything is behind `communitiesEnabled()` (`src/server/communities-mode.ts`); pages call `notFound()` and API routes return 404 when it is off.
- **No outbound email** and no payments. Paid stays refused.
- **Copy:** only in `messages/en.json`. No helper paragraphs, except the rules and 18+ statements. Provider-neutral. Say "ministry", never "workspace".
- **UI:**
  - full width, 44px tap targets (`min-h-11`), light and dark;
  - Studio Admin style through `src/components/ui/*`;
  - Eden design reference (no Eden visuals or copy).
- **Raw data:** tokens and emails are never stored raw; only SHA-256 hex hashes plus a masked email hint.
- **Neutral refusals:** "not found", "invite invalid" and "banned" never reveal more than the same neutral text.
- **Test environment:**
  - Integration tests need `service postgresql start` and `TEST_DATABASE_URL=postgresql://postgres:local-ci-only@127.0.0.1:5432/harvest_test`.
  - Restricted-owner suites run as user `tester` (see `docs/setup/ci-final-review.md`).
  - Browser tests use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` and `--trace off`.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/community-listing.ts` (new) | Pure rules: `listingFor`, `discoverEligible`, `hashSecret`, `emailHash`, `emailHint`, `newInviteToken`. |
| `src/db/schema.ts` | New columns and tables. |
| `drizzle/0036_community_joining.sql` (+ snapshot, journal) | DDL, RLS, owner policies, definers. |
| `src/server/communities.ts` | Owner side: update fields, projection sync, invites, draft limit. |
| `src/server/community-joining.ts` (new) | Public and member side: public page, enter (join/redeem), discover, my communities and invites. |
| `src/app/api/communities/[slug]/join/route.ts` (new) | POST join or redeem. |
| `src/app/api/workspaces/[tenantId]/communities/[communityId]/invites/route.ts` (+ `[inviteId]/route.ts`) (new) | Owner invites. |
| `src/app/communities/[slug]/page.tsx`, `.../home/page.tsx` (new) | Public landing and member home. |
| `src/app/discover/page.tsx` (new) | Discover. |
| `src/app/account/communities/page.tsx` (new) | My communities. |
| `src/components/communities/join-dialog.tsx`, `discover-results.tsx`, `invite-dialog.tsx` (new) | Client components. |
| `src/components/communities/community-editor.tsx` | Description, rules, Show in Discover, invites. |

---

### Task 1: Pure listing and invite helpers

**Files:**
- Create: `src/lib/community-listing.ts`
- Test: `tests/unit/community-listing.test.ts`

**Interfaces:**
- Produces:
  - `type ListingSource = { id: string; tenantId: string; slug: string; name: string; tagline: string | null; status: string; visibility: string; pricing: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; allowEntitlement: boolean; discoverOptIn: boolean }`
  - `type Listing = { resourceType: "community"; resourceId: string; tenantId: string; slug: string; name: string; tagline: string | null; hostName: string; pricing: string; admission: string[]; searchText: string }`
  - `listingFor(c: ListingSource, hostName: string, eligible: boolean): Listing | null`
  - `discoverEligible(tenantId: string): boolean`
  - `hashSecret(value: string): string`
  - `emailHash(email: string): string`
  - `emailHint(email: string): string`
  - `newInviteToken(): string` (64 hex)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { discoverEligible, emailHash, emailHint, hashSecret, listingFor, newInviteToken, type ListingSource } from "../../src/lib/community-listing";

const base: ListingSource = { id: "00000000-0000-4000-8000-0000000000c1", tenantId: "00000000-0000-4000-8000-0000000000a1", slug: "grace-study",
  name: "Grace Study", tagline: "Weekly", status: "published", visibility: "listed", pricing: "free",
  allowOpen: true, allowApply: false, allowInvite: true, allowEntitlement: false, discoverOptIn: true };

describe("listingFor", () => {
  it("lists a published, listed, opted-in community of an eligible ministry", () => {
    expect(listingFor(base, "Grace Church", true)).toEqual({ resourceType: "community", resourceId: base.id, tenantId: base.tenantId, slug: "grace-study",
      name: "Grace Study", tagline: "Weekly", hostName: "Grace Church", pricing: "free", admission: ["open", "invite"], searchText: "grace study weekly grace church" });
  });
  it.each([
    ["draft", { status: "draft" }], ["archived", { status: "archived" }], ["unlisted", { visibility: "unlisted" }],
    ["hidden", { visibility: "hidden" }], ["not opted in", { discoverOptIn: false }],
  ] as const)("does not list a %s community", (_label, change) => { expect(listingFor({ ...base, ...change }, "Grace Church", true)).toBeNull(); });
  it("does not list when the ministry is not eligible", () => { expect(listingFor(base, "Grace Church", false)).toBeNull(); });
});

describe("invite helpers", () => {
  it("hashes secrets and normalised emails as sha256 hex", () => {
    expect(hashSecret("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(emailHash("  Jane@Example.TEST ")).toBe(hashSecret("jane@example.test"));
  });
  it("masks an email to its first letter and domain", () => {
    expect(emailHint("jane@example.test")).toBe("j•••@example.test");
    expect(emailHint("J@x.io")).toBe("j•••@x.io");
  });
  it("makes 64-hex unique tokens", () => {
    const a = newInviteToken(), b = newInviteToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/); expect(a).not.toBe(b);
  });
  it("treats every ministry as eligible until subscription billing exists", () => { expect(discoverEligible(base.tenantId)).toBe(true); });
});
```

- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run --project unit tests/unit/community-listing.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { createHash, randomBytes } from "node:crypto";

// ADR 0013 §7 + PR 3 design. Discover lists a community only when it is published, Listed, opted in by its
// owner and its ministry is eligible. Eligibility = an active Harvest subscription (founder, 11 Nov); billing
// does not exist yet, so every ministry is eligible until it does. Billing replaces discoverEligible's body.
export type ListingSource = { id: string; tenantId: string; slug: string; name: string; tagline: string | null; status: string; visibility: string;
  pricing: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; allowEntitlement: boolean; discoverOptIn: boolean };
export type Listing = { resourceType: "community"; resourceId: string; tenantId: string; slug: string; name: string; tagline: string | null;
  hostName: string; pricing: string; admission: string[]; searchText: string };

export function discoverEligible(tenantId: string): boolean { void tenantId; return true; }

export function listingFor(c: ListingSource, hostName: string, eligible: boolean): Listing | null {
  if (!eligible || c.status !== "published" || c.visibility !== "listed" || !c.discoverOptIn) return null;
  const admission = ([["open", c.allowOpen], ["apply", c.allowApply], ["invite", c.allowInvite], ["entitlement", c.allowEntitlement]] as const)
    .filter(([, on]) => on).map(([key]) => key);
  return { resourceType: "community", resourceId: c.id, tenantId: c.tenantId, slug: c.slug, name: c.name, tagline: c.tagline, hostName, pricing: c.pricing,
    admission, searchText: [c.name, c.tagline ?? "", hostName].join(" ").toLowerCase().replace(/\s+/g, " ").trim() };
}

export const hashSecret = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const emailHash = (email: string) => hashSecret(email.trim().toLowerCase());
export function emailHint(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}
export const newInviteToken = () => randomBytes(32).toString("hex");
```

- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: PASS (12 tests).
- [ ] **Step 5: Commit.** `git add src/lib/community-listing.ts tests/unit/community-listing.test.ts && git commit -m "feat(communities): listing and invite helpers"`

---

### Task 2: Migration 0036 (schema, RLS, definers)

**Files:**
- Modify: `src/db/schema.ts` (`communities`, `communityMemberships`; add `communityInvites`, `discoverListings`)
- Create: `drizzle/0036_community_joining.sql` (generated DDL plus hand-written RLS and definers), snapshot, journal entry
- Test: `tests/integration/community-joining-db.test.ts`

**Interfaces:**
- Consumes: Task 1 hashing (tests compute hashes with `hashSecret` and `emailHash`, which match SQL `encode(sha256(convert_to(lower(btrim(email)),'UTF8')),'hex')`).
- Produces these SQL functions, callable by `harvest_app`:
  - `public.community_public(p_slug text, p_invite_hash text) returns jsonb`, or null when not visible.
  - `public.community_enter(p_slug text, p_rules_version integer, p_adult boolean, p_invite_hash text, p_invite_id uuid) returns text`. Outcomes: `joined | already_member | not_found | not_allowed | rules_changed | adult_required | banned | invite_invalid`. It requires `app.user_id` and raises `42501` without it.
  - `public.discover_communities(p_query text, p_open_only boolean, p_after timestamptz, p_after_id uuid, p_limit integer) returns setof jsonb`.
  - `public.community_my_invites() returns setof jsonb`. Requires `app.user_id`.
- Produces these Drizzle tables: `communityInvites`, `discoverListings`. New columns: `communities.description`, `communities.rules`, `communities.rulesVersion`, `communities.discoverOptIn`, `communityMemberships.rulesVersionAccepted`, `communityMemberships.adultConfirmedAt`.

- [ ] **Step 1: Schema.** Add to `communities` in `src/db/schema.ts`:

```ts
  description: text("description"), rules: text("rules"),
  rulesVersion: integer("rules_version").notNull().default(0),
  discoverOptIn: boolean("discover_opt_in").notNull().default(false),
```

Add these checks to its check list:

```ts
  check("community_description", sql`${t.description} is null or length(${t.description}) between 1 and 2000`),
  check("community_rules", sql`${t.rules} is null or length(${t.rules}) between 1 and 5000`),
  check("community_rules_version", sql`${t.rulesVersion} >= 0`),
```

Add to `communityMemberships`:

```ts
  rulesVersionAccepted: integer("rules_version_accepted"),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }),
```

Add the new tables:

```ts
export const communityInvites = pgTable("community_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(), communityId: uuid("community_id").notNull(),
  emailHash: text("email_hash").notNull(), emailHint: text("email_hint").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }), redeemedBy: text("redeemed_by").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.communityId], foreignColumns: [communities.tenantId, communities.id] }).onDelete("cascade"),
  uniqueIndex("community_invites_open_idx").on(t.communityId, t.emailHash).where(sql`${t.redeemedAt} is null and ${t.revokedAt} is null`),
  check("community_invite_hashes", sql`${t.emailHash} ~ '^[a-f0-9]{64}$' and ${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
  check("community_invite_hint", sql`length(${t.emailHint}) between 3 and 320`),
]);

export const discoverListings = pgTable("discover_listings", {
  resourceType: text("resource_type").notNull(), resourceId: uuid("resource_id").notNull(),
  tenantId: uuid("tenant_id").notNull().references(() => workspaces.tenantId, { onDelete: "cascade" }),
  slug: text("slug").notNull(), name: text("name").notNull(), tagline: text("tagline"), hostName: text("host_name").notNull(),
  pricing: text("pricing").notNull(), admission: text("admission").array().notNull(), searchText: text("search_text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.resourceType, t.resourceId] }),
  index("discover_listings_order_idx").on(t.resourceType, t.updatedAt, t.resourceId),
  check("discover_resource_type", sql`${t.resourceType} in ('community')`),
]);
```

Match the existing import names in `schema.ts` (`foreignKey`, `uniqueIndex`, `index`, `primaryKey`, `integer`, `boolean`) and add any that are missing.

- [ ] **Step 2: Generate the DDL.** Run `npx drizzle-kit generate --name community_joining`. Expected: `drizzle/0036_community_joining.sql` plus snapshot and journal entry. Check that the file only adds columns, the two tables, FKs, indexes and checks.

- [ ] **Step 3: Append RLS, owner policies and definers** to `drizzle/0036_community_joining.sql`:

```sql
--> statement-breakpoint
-- PR 3: invites and the Discover projection are staff-only tenant tables. Members and visitors reach them only
-- through the definers below. Invites are revoked or redeemed, never deleted; listings are deleted when they stop qualifying.
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['community_invites','discover_listings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, harvest_app', relation_name);
  EXECUTE format($p$CREATE POLICY %I ON public.%I TO harvest_app
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, relation_name || '_staff', relation_name);
 END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.community_invites TO harvest_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discover_listings TO harvest_app;
--> statement-breakpoint
-- The migration role owns the definers and obeys FORCE RLS without BYPASSRLS (HC-03 pattern). It gets only
-- policies keyed on settings the definers set and clear themselves; no harvest_app policy reads them.
DO $$ BEGIN
  EXECUTE format($p$CREATE POLICY community_definer_read ON public.communities FOR SELECT TO %I USING (
      slug = nullif(current_setting('app.community_resolve_slug', true), '')
      OR tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid
      OR id::text = ANY (string_to_array(nullif(current_setting('app.community_resolve_ids', true), ''), ',')))$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.community_memberships TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.entitlements TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_tenant ON public.community_invites TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid
      OR token_hash = nullif(current_setting('app.community_resolve_invite', true), '')
      OR email_hash = nullif(current_setting('app.community_resolve_email', true), ''))
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_audit ON public.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY community_definer_host ON public.workspaces FOR SELECT TO %I
    USING (tenant_id = nullif(current_setting('app.community_definer_tenant', true), '')::uuid)$p$, current_user);
  EXECUTE format($p$CREATE POLICY discover_definer_read ON public.discover_listings FOR SELECT TO %I
    USING (current_setting('app.discover_read', true) = 'on')$p$, current_user);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_definer_reset() RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  SELECT set_config(name, '', true) FROM unnest(ARRAY['app.community_resolve_slug','app.community_definer_tenant','app.community_resolve_ids',
    'app.community_resolve_invite','app.community_resolve_email','app.discover_read']) AS name;
$$;
--> statement-breakpoint
-- Public page data. Draft/archived communities and hidden ones without a valid invite return null.
CREATE FUNCTION public.community_public(p_slug text, p_invite_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c record; host text; invited boolean := false;
BEGIN
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  IF p_invite_hash IS NOT NULL THEN
    PERFORM set_config('app.community_resolve_invite', p_invite_hash, true);
    invited := EXISTS (SELECT 1 FROM public.community_invites i WHERE i.token_hash = p_invite_hash AND i.community_id = c.id AND i.tenant_id = c.tenant_id
      AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now());
  END IF;
  IF c.visibility = 'hidden' AND NOT invited THEN PERFORM public.community_definer_reset(); RETURN NULL; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  SELECT w.name INTO host FROM public.workspaces w WHERE w.tenant_id = c.tenant_id;
  PERFORM public.community_definer_reset();
  RETURN jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'tagline', c.tagline, 'description', c.description, 'hostName', host,
    'pricing', c.pricing, 'visibility', c.visibility, 'allowOpen', c.allow_open, 'allowApply', c.allow_apply, 'allowInvite', c.allow_invite,
    'rules', c.rules, 'rulesVersion', c.rules_version, 'invited', invited);
END $$;
--> statement-breakpoint
-- Join (open) or redeem (invite by token hash or by id). Returns an outcome; never raises on a business refusal.
CREATE FUNCTION public.community_enter(p_slug text, p_rules_version integer, p_adult boolean, p_invite_hash text, p_invite_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); c record; m record; inv record; mine text; via_invite boolean; had_membership boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  via_invite := p_invite_hash IS NOT NULL OR p_invite_id IS NOT NULL;
  PERFORM set_config('app.community_resolve_slug', coalesce(p_slug, ''), true);
  SELECT * INTO c FROM public.communities WHERE communities.slug = p_slug AND communities.status = 'published';
  IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
  PERFORM set_config('app.community_definer_tenant', c.tenant_id::text, true);
  IF via_invite THEN
    SELECT encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') INTO mine FROM public.users u WHERE u.id = actor AND u.email_verified;
    SELECT * INTO inv FROM public.community_invites i WHERE i.tenant_id = c.tenant_id AND i.community_id = c.id
      AND (i.token_hash = p_invite_hash OR i.id = p_invite_id) AND i.email_hash = mine
      AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() FOR UPDATE;
    IF NOT FOUND THEN PERFORM public.community_definer_reset(); RETURN 'invite_invalid'; END IF;
  ELSE
    IF c.visibility = 'hidden' THEN PERFORM public.community_definer_reset(); RETURN 'not_found'; END IF;
    IF NOT c.allow_open THEN PERFORM public.community_definer_reset(); RETURN 'not_allowed'; END IF;
  END IF;
  IF NOT coalesce(p_adult, false) THEN PERFORM public.community_definer_reset(); RETURN 'adult_required'; END IF;
  IF p_rules_version IS DISTINCT FROM c.rules_version THEN PERFORM public.community_definer_reset(); RETURN 'rules_changed'; END IF;
  SELECT * INTO m FROM public.community_memberships WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor FOR UPDATE;
  had_membership := FOUND; -- captured now: FOUND changes after the next UPDATE
  IF had_membership AND m.status = 'banned' THEN PERFORM public.community_definer_reset(); RETURN 'banned'; END IF;
  IF via_invite THEN UPDATE public.community_invites SET redeemed_at = now(), redeemed_by = actor WHERE id = inv.id; END IF;
  IF had_membership AND m.status = 'active' THEN PERFORM public.community_definer_reset(); RETURN 'already_member'; END IF;
  IF NOT had_membership THEN
    INSERT INTO public.community_memberships (tenant_id, community_id, user_id, role, status, joined_at, rules_version_accepted, adult_confirmed_at)
      VALUES (c.tenant_id, c.id, actor, 'member', 'active', now(), c.rules_version, now());
  ELSE
    -- Re-entry never restores a staff role (ADR 0013 §4a).
    UPDATE public.community_memberships SET status = 'active', role = 'member', joined_at = now(), updated_at = now(),
      rules_version_accepted = c.rules_version, adult_confirmed_at = now()
      WHERE tenant_id = c.tenant_id AND community_id = c.id AND user_id = actor;
  END IF;
  INSERT INTO public.entitlements (tenant_id, user_id, resource_type, resource_id, source, granted_by)
    VALUES (c.tenant_id, actor, 'community', c.id, CASE WHEN via_invite THEN 'invitation' ELSE 'community_free_join' END,
      CASE WHEN via_invite THEN inv.created_by ELSE NULL END);
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_id)
    VALUES (c.tenant_id, actor, CASE WHEN via_invite THEN 'community.invite_redeem' ELSE 'community.join' END, c.id::text);
  PERFORM public.community_definer_reset();
  RETURN 'joined';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.discover_communities(p_query text, p_open_only boolean, p_after timestamptz, p_after_id uuid, p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM set_config('app.discover_read', 'on', true);
  RETURN QUERY SELECT jsonb_build_object('id', d.resource_id, 'slug', d.slug, 'name', d.name, 'tagline', d.tagline, 'hostName', d.host_name,
      'pricing', d.pricing, 'admission', to_jsonb(d.admission), 'updatedAt', d.updated_at)
    FROM public.discover_listings d
    WHERE d.resource_type = 'community'
      AND (coalesce(p_query, '') = '' OR d.search_text LIKE '%' || replace(replace(replace(lower(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      AND (NOT coalesce(p_open_only, false) OR 'open' = ANY (d.admission))
      AND (p_after IS NULL OR (d.updated_at, d.resource_id) < (p_after, p_after_id))
    ORDER BY d.updated_at DESC, d.resource_id DESC
    LIMIT least(greatest(coalesce(p_limit, 24), 1), 48);
  PERFORM public.community_definer_reset();
END $$;
--> statement-breakpoint
CREATE FUNCTION public.community_my_invites() RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor text := nullif(current_setting('app.user_id', true), ''); mine text; ids text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'community access denied' USING ERRCODE = '42501'; END IF;
  SELECT encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') INTO mine FROM public.users u WHERE u.id = actor AND u.email_verified;
  IF mine IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.community_resolve_email', mine, true);
  SELECT string_agg(i.community_id::text, ',') INTO ids FROM public.community_invites i
    WHERE i.email_hash = mine AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now();
  PERFORM set_config('app.community_resolve_ids', coalesce(ids, ''), true);
  RETURN QUERY SELECT jsonb_build_object('inviteId', i.id, 'slug', c.slug, 'name', c.name, 'expiresAt', i.expires_at)
    FROM public.community_invites i JOIN public.communities c ON c.tenant_id = i.tenant_id AND c.id = i.community_id
    WHERE i.email_hash = mine AND i.redeemed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND c.status = 'published'
    ORDER BY i.expires_at;
  PERFORM public.community_definer_reset();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.community_definer_reset(), public.community_public(text, text), public.community_enter(text, integer, boolean, text, uuid),
  public.discover_communities(text, boolean, timestamptz, uuid, integer), public.community_my_invites() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.community_public(text, text), public.community_enter(text, integer, boolean, text, uuid),
  public.discover_communities(text, boolean, timestamptz, uuid, integer), public.community_my_invites() TO harvest_app;
```

- [ ] **Step 4: Write the failing integration test** `tests/integration/community-joining-db.test.ts`. It calls the definers directly through `withUser` and `db.transaction`, and asserts outcomes.

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { emailHash, emailHint, hashSecret, newInviteToken } from "../../src/lib/community-listing";

let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, open: string, hidden: string;
const people = ["j-owner", "j-b-owner", "j-joiner", "j-invited", "j-other", "j-banned"];
const enter = (user: string, slug: string, version: number, adult: boolean, hash: string | null = null, id: string | null = null) =>
  withUser(f.db, user, async (tx) => (await tx.execute<{ o: string }>(sql`select public.community_enter(${slug}, ${version}, ${adult}, ${hash}, ${id}::uuid) as o`)).rows[0].o);
const publicView = (slug: string, hash: string | null = null) => f.db.transaction(async (tx) => (await tx.execute<{ v: Record<string, unknown> | null }>(sql`select public.community_public(${slug}, ${hash}) as v`)).rows[0].v);

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "j-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "j-b-owner", "Other", "creator")).tenantId;
  open = (await createCommunity(f.db, "j-owner", a, { name: "Open study", slug: "open-study" })).id;
  hidden = (await createCommunity(f.db, "j-owner", a, { name: "Secret team", slug: "secret-team" })).id;
  await f.admin.query("update communities set status = 'published', visibility = 'listed', allow_open = true, rules = 'Be kind.', rules_version = 1 where id = $1", [open]);
  await f.admin.query("update communities set status = 'published', visibility = 'hidden' where id = $1", [hidden]);
});
afterAll(async () => { await f?.close(); });

it("shows published listed communities, hides drafts and hidden ones without an invite", async () => {
  expect(await publicView("open-study")).toMatchObject({ name: "Open study", hostName: "Grace Church", rules: "Be kind.", rulesVersion: 1, invited: false });
  expect(await publicView("secret-team")).toBeNull();
  expect(await publicView("no-such-community")).toBeNull();
  await f.admin.query("update communities set status = 'draft' where id = $1", [open]);
  expect(await publicView("open-study")).toBeNull();
  await f.admin.query("update communities set status = 'published' where id = $1", [open]);
});

it("joins with current rules and adult confirmation, idempotently, and refuses the rest", async () => {
  expect(await enter("j-joiner", "open-study", 0, true)).toBe("rules_changed");
  expect(await enter("j-joiner", "open-study", 1, false)).toBe("adult_required");
  expect(await enter("j-joiner", "secret-team", 0, true)).toBe("not_found");
  expect(await enter("j-joiner", "open-study", 1, true)).toBe("joined");
  expect(await enter("j-joiner", "open-study", 1, true)).toBe("already_member");
  const { rows } = await f.admin.query("select role, status, rules_version_accepted, adult_confirmed_at is not null as adult from community_memberships where user_id = 'j-joiner'");
  expect(rows).toEqual([{ role: "member", status: "active", rules_version_accepted: 1, adult: true }]);
  expect((await f.admin.query("select source from entitlements where user_id = 'j-joiner'")).rows).toEqual([{ source: "community_free_join" }]);
  expect((await f.admin.query("select action from audit_logs where actor_id = 'j-joiner'")).rows).toEqual([{ action: "community.join" }]);
  await f.admin.query("update communities set allow_open = false where id = $1", [open]);
  expect(await enter("j-other", "open-study", 1, true)).toBe("not_allowed");
  await f.admin.query("update communities set allow_open = true where id = $1", [open]);
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status) values ($1, $2, 'j-banned', 'member', 'banned')", [a, open]);
  expect(await enter("j-banned", "open-study", 1, true)).toBe("banned");
  await expect(f.db.transaction((tx) => tx.execute(sql`select public.community_enter('open-study', 1, true, null, null)`))).rejects.toMatchObject({ cause: { code: "42501" } });
});

it("redeems a personal invite once, only for the invited email, before expiry and revocation", async () => {
  const token = newInviteToken(), stale = newInviteToken(), revoked = newInviteToken();
  const insert = (t: string, email: string, expires = "now() + interval '14 days'") => f.admin.query(
    `insert into community_invites (tenant_id, community_id, email_hash, email_hint, token_hash, created_by, expires_at) values ($1, $2, $3, $4, $5, 'j-owner', ${expires}) returning id`,
    [a, hidden, emailHash(email), emailHint(email), hashSecret(t)]);
  await insert(token, "j-invited@example.test");
  expect(await publicView("secret-team", hashSecret(token))).toMatchObject({ name: "Secret team", invited: true });
  expect(await enter("j-other", "secret-team", 0, true, hashSecret(token))).toBe("invite_invalid");
  expect(await enter("j-invited", "open-study", 1, true, hashSecret(token))).toBe("invite_invalid");
  expect(await enter("j-invited", "secret-team", 0, true, hashSecret(token))).toBe("joined");
  expect(await enter("j-invited", "secret-team", 0, true, hashSecret(token))).toBe("invite_invalid");
  expect((await f.admin.query("select source, granted_by from entitlements where user_id = 'j-invited'")).rows).toEqual([{ source: "invitation", granted_by: "j-owner" }]);
  await insert(stale, "j-other@example.test", "now() - interval '1 minute'");
  expect(await enter("j-other", "secret-team", 0, true, hashSecret(stale))).toBe("invite_invalid");
  const { rows: [{ id }] } = await insert(revoked, "j-other@example.test");
  await f.admin.query("update community_invites set revoked_at = now() where id = $1", [id]);
  expect(await enter("j-other", "secret-team", 0, true, null, id)).toBe("invite_invalid");
});

it("lists a person's own open invitations only", async () => {
  await f.admin.query(`insert into community_invites (tenant_id, community_id, email_hash, email_hint, token_hash, expires_at) values ($1, $2, $3, 'j•••@example.test', $4, now() + interval '1 day')`,
    [a, hidden, emailHash("j-joiner@example.test"), hashSecret(newInviteToken())]);
  const mine = await withUser(f.db, "j-joiner", async (tx) => (await tx.execute<{ v: { slug: string } }>(sql`select public.community_my_invites() as v`)).rows.map((r) => r.v.slug));
  expect(mine).toEqual(["secret-team"]);
  expect(await withUser(f.db, "j-b-owner", async (tx) => (await tx.execute(sql`select public.community_my_invites()`)).rows)).toEqual([]);
});

it("returns Discover rows only from the projection, filtered and paged", async () => {
  await f.admin.query(`insert into discover_listings (resource_type, resource_id, tenant_id, slug, name, tagline, host_name, pricing, admission, search_text)
    values ('community', $1, $2, 'open-study', 'Open study', null, 'Grace Church', 'free', '{open,invite}', 'open study grace church')`, [open, a]);
  const find = (q: string, openOnly = false) => f.db.transaction(async (tx) => (await tx.execute<{ v: { slug: string } }>(sql`select public.discover_communities(${q}, ${openOnly}, null, null, 24) as v`)).rows.map((r) => r.v.slug));
  expect(await find("")).toEqual(["open-study"]);
  expect(await find("GRACE")).toEqual(["open-study"]);
  expect(await find("%")).toEqual([]);
  expect(await find("nothing")).toEqual([]);
});

it("keeps invites and listings out of reach of members, visitors and other ministries", async () => {
  expect(await withUser(f.db, "j-joiner", async (tx) => (await tx.execute(sql`select * from community_invites`)).rows)).toEqual([]);
  expect(await withUser(f.db, "j-joiner", async (tx) => (await tx.execute(sql`select * from discover_listings`)).rows)).toEqual([]);
  expect(await withTenant(f.db, "j-b-owner", b, "communities:manage", async (tx) => (await tx.execute(sql`select * from community_invites`)).rows)).toEqual([]);
  expect((await f.admin.query("select count(*)::int as n from community_invites where token_hash !~ '^[a-f0-9]{64}$' or email_hash !~ '^[a-f0-9]{64}$'")).rows[0].n).toBe(0);
});
```

- [ ] **Step 5: Run it and confirm it passes.** `npx vitest run --project integration tests/integration/community-joining-db.test.ts`. Expected: PASS. If a test fails, fix the SQL, not the test.
- [ ] **Step 6: Restricted-owner test.** Create `tests/integration/community-joining-definer-owner.test.ts` by copying the structure of `tests/integration/hc03-definer-owner.test.ts`:
  - role `harvest_test_community_owner`;
  - definers: the four functions plus `community_definer_reset()`;
  - tables: `communities, community_memberships, entitlements, community_invites, audit_logs, workspaces, discover_listings, users`. Grant `select on users`, and copy only the policies whose roles include the owner. `users` has no RLS, so exclude it from the "every table has an owner policy" assertion.
  - Body: re-run one join, one redeem and one public view through the services from Task 3 (or the raw `select` calls above) with ownership transferred, and expect the same outcomes.
  - Run as `tester` per Global Constraints. Expected: PASS.
- [ ] **Step 7: Commit.** `git add src/db/schema.ts drizzle tests/integration/community-joining-db.test.ts tests/integration/community-joining-definer-owner.test.ts && git commit -m "feat(communities): migration 0036 joining, invites and Discover projection"`

---

### Task 3: Server services

**Files:**
- Modify: `src/server/communities.ts`
- Create: `src/server/community-joining.ts`
- Modify: `messages/en.json` (`Errors.communityDraftLimit`, `Errors.inviteInvalid`, `Errors.communityJoinUnavailable`, `Errors.communityRulesChanged`, `Errors.adultConfirmationRequired`)
- Test: extend `tests/integration/communities.test.ts`; create `tests/integration/community-joining.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 SQL functions and tables.
- Produces (owner, in `src/server/communities.ts`):
  - `updateCommunity(..., { version, description?, rules?, discoverOptIn?, ...existing })`. A rules change bumps `rulesVersion`; every update re-syncs the listing.
  - `publishCommunity`, which re-syncs the listing.
  - `createInvite(db, userId, workspace, communityId, raw: { email: string }) => Promise<{ id: string; path: string; expiresAt: Date; emailHint: string }>`, where `path = /communities/${slug}?invite=${token}`.
  - `listInvites(db, userId, workspace, communityId) => Promise<{ id; emailHint; expiresAt; status: "pending" | "redeemed" | "revoked" | "expired" }[]>`.
  - `revokeInvite(db, userId, workspace, communityId, inviteId, raw: {})`.
  - `syncListing(tx, tenantId, communityId): Promise<void>`.
- Produces (member/public, in `src/server/community-joining.ts`):
  - `type PublicCommunity = { id: string; slug: string; name: string; tagline: string | null; description: string | null; hostName: string; pricing: string; visibility: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; rules: string | null; rulesVersion: number; invited: boolean }`
  - `getPublicCommunity(db, slug: string, inviteToken?: string): Promise<PublicCommunity | null>`
  - `enterCommunity(db, userId, slug, raw: { rulesVersion: number; adult: boolean; invite?: string; inviteId?: string }): Promise<{ outcome: "joined" | "already_member" }>`. It throws `AccessError`: 404 for not_found and invite_invalid (`Errors.inviteInvalid` for the latter), 409 `communityRulesChanged`, 409 `adultConfirmationRequired`, and 409 `communityJoinUnavailable` for not_allowed and banned.
  - `isActiveMember(db, userId, slug): Promise<{ id: string; name: string } | null>`, via `withUser` and the existing member policies.
  - `listDiscover(db, raw: { q?: string; open?: boolean; after?: string }): Promise<{ items: DiscoverItem[]; next: string | null }>`. `after` is the base64url of `${updatedAt}|${id}`.
  - `myCommunities(db, userId): Promise<{ joined: { slug; name; role }[]; invited: { inviteId; slug; name; expiresAt }[]; hosted: { tenantId; id; name; status }[] }>`.

- [ ] **Step 1: Write the failing integration tests.** In `tests/integration/community-joining.test.ts`, use fixtures like Task 2 but create everything through services:
  - owner creates a community, updates `{ allowOpen: true, visibility: "listed", rules: "Be kind.", discoverOptIn: true }`, publishes;
  - `listDiscover({})` returns it; `listDiscover({ q: "zzz" })` returns `[]`;
  - unpublish → listing gone; republish → back; `discoverOptIn: false` → gone; `visibility: "unlisted"` → gone, but `getPublicCommunity` still returns it; `hidden` → `getPublicCommunity` returns null;
  - changing rules bumps `rulesVersion` from 1 to 2; `enterCommunity` with the old version → 409 `communityRulesChanged`;
  - `createInvite` → `path` contains `?invite=` plus a 64-hex token; the DB row stores only hashes; `listInvites` shows `pending` with the hint; second account redeem via `enterCommunity(..., { invite: token })` → `joined`; `listInvites` shows `redeemed`;
  - `revokeInvite` → status `revoked`, and redeem → 404 `inviteInvalid`;
  - a viewer cannot `createInvite` (403); ministry B cannot `listInvites` for A's community (403/404);
  - `myCommunities` for the joiner lists Joined; for an invited user, Invited; for the owner, Hosted;
  - `createCommunity` beyond 50 per ministry → 409 `communityDraftLimit` (insert 49 rows with `f.admin`, then the 50th succeeds and the 51st is refused).

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run --project integration tests/integration/community-joining.test.ts`. Expected: FAIL, functions missing.
- [ ] **Step 3: Implement the owner side** in `src/server/communities.ts`:

```ts
import { communityInvites, discoverListings, workspaces } from "../db/schema";
import { discoverEligible, emailHash, emailHint, hashSecret, listingFor, newInviteToken } from "../lib/community-listing";

const description = z.string().trim().min(1).max(2000);
const rules = z.string().trim().min(1).max(5000);
// add to updateInput: description: description.nullable().optional(), rules: rules.nullable().optional(), discoverOptIn: z.boolean().optional(),

export async function syncListing(tx: Transaction, tenantId: string, communityId: string) {
  const [c] = await tx.select().from(communities).where(and(eq(communities.tenantId, tenantId), eq(communities.id, communityId)));
  const [host] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, tenantId));
  const listing = c && host ? listingFor(c, host.name, discoverEligible(tenantId)) : null;
  const key = and(eq(discoverListings.resourceType, "community"), eq(discoverListings.resourceId, communityId));
  if (!listing) { await tx.delete(discoverListings).where(key); return; }
  const values = { ...listing, updatedAt: new Date() };
  await tx.insert(discoverListings).values(values).onConflictDoUpdate({ target: [discoverListings.resourceType, discoverListings.resourceId], set: values });
}
```

  - In `updateCommunity`: if `changes.rules !== undefined && changes.rules !== current.rules`, set `rulesVersion: current.rulesVersion + 1`. After the update, `await syncListing(tx, tenantId, id)`.
  - In `publishCommunity`, call `await syncListing(tx, tenantId, id)` after the update.
  - In `createCommunity`, before the insert:

```ts
const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(communities).where(eq(communities.tenantId, tenantId));
if (n >= 50) throw new AccessError(409, message("Errors.communityDraftLimit"));
```

  - Invites:

```ts
const inviteInput = z.object({ email: z.email().max(320) }).strict();
const INVITE_DAYS = 14;

export async function createInvite(db: Database, userId: string, workspace: string, communityId: string, raw: unknown) {
  const { email } = inviteInput.parse(raw), id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const community = await ownCommunity(tx, tenantId, id);
    const token = newInviteToken(), expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
    // A new invite for the same address replaces the open one.
    await tx.update(communityInvites).set({ revokedAt: new Date() }).where(and(eq(communityInvites.tenantId, tenantId), eq(communityInvites.communityId, id),
      eq(communityInvites.emailHash, emailHash(email)), isNull(communityInvites.redeemedAt), isNull(communityInvites.revokedAt)));
    const [row] = await tx.insert(communityInvites).values({ tenantId, communityId: id, emailHash: emailHash(email), emailHint: emailHint(email),
      tokenHash: hashSecret(token), createdBy: userId, expiresAt }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.invite_create", targetId: id, metadata: { inviteId: row.id } });
    return { id: row.id, path: `/communities/${community.slug}?invite=${token}`, expiresAt, emailHint: row.emailHint };
  });
}

export function listInvites(db: Database, userId: string, workspace: string, communityId: string) {
  const id = z.uuid().parse(communityId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    await ownCommunity(tx, tenantId, id);
    const rows = await tx.select().from(communityInvites).where(and(eq(communityInvites.tenantId, tenantId), eq(communityInvites.communityId, id)))
      .orderBy(desc(communityInvites.createdAt)).limit(200);
    const now = Date.now();
    return rows.map((r) => ({ id: r.id, emailHint: r.emailHint, expiresAt: r.expiresAt,
      status: r.redeemedAt ? "redeemed" as const : r.revokedAt ? "revoked" as const : r.expiresAt.getTime() <= now ? "expired" as const : "pending" as const }));
  });
}

export async function revokeInvite(db: Database, userId: string, workspace: string, communityId: string, inviteId: string, raw: unknown) {
  z.object({}).strict().parse(raw);
  const id = z.uuid().parse(communityId), invite = z.uuid().parse(inviteId);
  return withTenant(db, userId, z.uuid().parse(workspace), "communities:manage", async (tx, tenantId) => {
    const [row] = await tx.update(communityInvites).set({ revokedAt: new Date() }).where(and(eq(communityInvites.tenantId, tenantId), eq(communityInvites.communityId, id),
      eq(communityInvites.id, invite), isNull(communityInvites.redeemedAt), isNull(communityInvites.revokedAt))).returning();
    if (!row) throw new AccessError(404, message("Errors.inviteInvalid"));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "community.invite_revoke", targetId: id, metadata: { inviteId: invite } });
  });
}
```

- [ ] **Step 4: Implement** `src/server/community-joining.ts`:

```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { communities, communityMemberships, workspaceMembers } from "../db/schema";
import { hashSecret } from "../lib/community-listing";
import { communitySlug } from "./communities";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withUser } from "./tenancy";

export type PublicCommunity = { id: string; slug: string; name: string; tagline: string | null; description: string | null; hostName: string; pricing: string;
  visibility: string; allowOpen: boolean; allowApply: boolean; allowInvite: boolean; rules: string | null; rulesVersion: number; invited: boolean };
export type DiscoverItem = { id: string; slug: string; name: string; tagline: string | null; hostName: string; pricing: string; admission: string[]; updatedAt: string };
const token = z.string().regex(/^[a-f0-9]{64}$/);

export async function getPublicCommunity(db: Database, slug: string, inviteToken?: string): Promise<PublicCommunity | null> {
  const parsed = communitySlug.safeParse(slug);
  if (!parsed.success) return null;
  const invite = inviteToken && token.safeParse(inviteToken).success ? hashSecret(inviteToken) : null;
  return db.transaction(async (tx) => (await tx.execute<{ v: PublicCommunity | null }>(sql`select public.community_public(${parsed.data}, ${invite}) as v`)).rows[0]?.v ?? null);
}

const enterInput = z.object({ rulesVersion: z.number().int().min(0), adult: z.boolean(), invite: token.optional(), inviteId: z.uuid().optional() }).strict();
const refusals: Record<string, [number, string]> = {
  not_found: [404, "Errors.communityNotFound"], invite_invalid: [404, "Errors.inviteInvalid"], rules_changed: [409, "Errors.communityRulesChanged"],
  adult_required: [409, "Errors.adultConfirmationRequired"], not_allowed: [409, "Errors.communityJoinUnavailable"], banned: [409, "Errors.communityJoinUnavailable"],
};
export async function enterCommunity(db: Database, userId: string, slug: string, raw: unknown) {
  const input = enterInput.parse(raw), parsed = communitySlug.parse(slug);
  const outcome = await withUser(db, userId, async (tx) => (await tx.execute<{ o: string }>(sql`select public.community_enter(${parsed}, ${input.rulesVersion},
    ${input.adult}, ${input.invite ? hashSecret(input.invite) : null}, ${input.inviteId ?? null}::uuid) as o`)).rows[0].o);
  if (outcome === "joined" || outcome === "already_member") return { outcome } as const;
  const [status, key] = refusals[outcome] ?? [409, "Errors.communityJoinUnavailable"];
  throw new AccessError(status, message(key));
}

export function isActiveMember(db: Database, userId: string, slug: string) {
  return withUser(db, userId, async (tx) => {
    const [row] = await tx.select({ id: communities.id, name: communities.name }).from(communities).where(eq(communities.slug, slug));
    return row ?? null; // communities_member policy: visible only through the caller's ACTIVE membership.
  });
}

const discoverInput = z.object({ q: z.string().trim().max(80).optional(), open: z.boolean().optional(), after: z.string().max(200).optional() }).strict();
export async function listDiscover(db: Database, raw: unknown) {
  const input = discoverInput.parse(raw);
  let after: Date | null = null, afterId: string | null = null;
  if (input.after) {
    const [at, id] = Buffer.from(input.after, "base64url").toString().split("|");
    const date = new Date(at);
    if (!Number.isNaN(date.getTime()) && z.uuid().safeParse(id).success) { after = date; afterId = id; }
  }
  const limit = 24;
  const rows = await db.transaction(async (tx) => (await tx.execute<{ v: DiscoverItem }>(sql`select public.discover_communities(${input.q ?? ""},
    ${input.open ?? false}, ${after}, ${afterId}::uuid, ${limit + 1}) as v`)).rows.map((r) => r.v));
  const items = rows.slice(0, limit), last = items.at(-1);
  return { items, next: rows.length > limit && last ? Buffer.from(`${last.updatedAt}|${last.id}`).toString("base64url") : null };
}

export async function myCommunities(db: Database, userId: string) {
  return withUser(db, userId, async (tx) => {
    const joined = await tx.select({ slug: communities.slug, name: communities.name, role: communityMemberships.role }).from(communityMemberships)
      .innerJoin(communities, and(eq(communities.tenantId, communityMemberships.tenantId), eq(communities.id, communityMemberships.communityId)))
      .where(and(eq(communityMemberships.userId, userId), eq(communityMemberships.status, "active"), eq(communities.status, "published")));
    const invited = (await tx.execute<{ v: { inviteId: string; slug: string; name: string; expiresAt: string } }>(sql`select public.community_my_invites() as v`)).rows.map((r) => r.v);
    const managed = (await tx.select({ tenantId: workspaceMembers.tenantId }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.roleId, ["owner", "admin"])))).map((r) => r.tenantId);
    const hosted = [];
    for (const tenantId of managed) {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      hosted.push(...await tx.select({ tenantId: communities.tenantId, id: communities.id, name: communities.name, status: communities.status })
        .from(communities).where(eq(communities.tenantId, tenantId)));
    }
    await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
    return { joined, invited, hosted };
  });
}
```

**Why `myCommunities` sets `app.tenant_id` itself:** the managed list comes from `workspace_members` rows locked to the caller in the same transaction (owner/admin role check above), which matches what `withTenant` verifies. Clearing it afterwards keeps the rest of the transaction member-only.

- [ ] **Step 5: Add the messages to `messages/en.json` under `Errors`:**

```json
"communityDraftLimit": "This ministry has reached its community limit.",
"inviteInvalid": "This invitation isn't valid for your account.",
"communityJoinUnavailable": "You can't join this community right now.",
"communityRulesChanged": "The community rules changed. Please review them again.",
"adultConfirmationRequired": "Confirm you are 18 or older to join."
```

- [ ] **Step 6: Run the tests.** `npx vitest run --project integration tests/integration/community-joining.test.ts tests/integration/communities.test.ts`. Expected: PASS.
- [ ] **Step 7: Run checks and commit.** `npx tsc --noEmit -p . && npm run lint`, then `git commit -am "feat(communities): owner invites, Discover projection sync and member joining services"` (add the new files explicitly).

---

### Task 4: API routes

**Files:**
- Create: `src/app/api/communities/[slug]/join/route.ts` (POST)
- Create: `src/app/api/discover/route.ts` (GET `?q=&open=1&after=`)
- Create: `src/app/api/workspaces/[tenantId]/communities/[communityId]/invites/route.ts` (GET list, POST create)
- Create: `src/app/api/workspaces/[tenantId]/communities/[communityId]/invites/[inviteId]/route.ts` (DELETE revoke)
- Modify: `src/app/api/workspaces/[tenantId]/communities/[communityId]/route.ts` (no change needed beyond the service accepting new fields)
- Test: extend `tests/unit/communities-flag.test.ts`

**Interfaces:**
- Consumes: Task 3 services.
- Produces:
  - `POST /api/communities/:slug/join` with body `{ rulesVersion, adult, invite?, inviteId? }` → `200 { outcome }`.
  - `GET /api/discover` → `{ items, next }`, with `Cache-Control: private, no-store`.
  - `GET/POST .../invites`; `DELETE .../invites/:inviteId` with body `{}`.

Every route follows the existing pattern:

```ts
const off = () => new Response(null, { status: 404 });
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) return off();
  try {
    verifyOrigin(request);
    const user = await verifiedUser(request), { slug } = await context.params;
    return Response.json(await enterCommunity(getDb(), user, slug, await request.json()));
  } catch (error) { return errorResponse(error); }
}
```

`GET /api/discover` needs no user. It parses `q` and `open` from `new URL(request.url).searchParams` into `{ q, open: open === "1", after }`.

- [ ] **Step 1: Extend `tests/unit/communities-flag.test.ts`.** Import the four new route modules and add their handlers to the production-404 list (keep the `touched` assertion). Mock `@/server/community-joining` and `@/server/communities` only if imports pull in `server-only` (the existing `vi.mock("server-only")` covers it).
- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run --project unit tests/unit/communities-flag.test.ts`. Expected: FAIL, modules missing.
- [ ] **Step 3: Write the four route files** as above. Revoke uses `revokeInvite(getDb(), user, tenantId, communityId, inviteId, await request.json())` and returns `new Response(null, { status: 204 })`.
- [ ] **Step 4: Run the unit, type and lint checks.** Run the unit test, then `npx tsc --noEmit -p .` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Rate limits (ADR 0013 §4a).**
  - Run `grep -rn "rate_limits\|rateLimit" src/server` to find a reusable request limiter outside Better Auth.
  - If one exists, apply it to `POST /api/communities/:slug/join`, keyed by the user, and to `GET /api/discover`, keyed by the client IP the same way the auth limiter does.
  - If none exists, do not invent one in this PR. Record "public request rate limits" as a deferred item in the acceptance doc and in ADR §4a, and tell the founder.
- [ ] **Step 6: Commit** `feat(communities): join, discover and invite API routes`.

---

### Task 5: Pages and components

**Files:**
- Create:
  - `src/app/communities/[slug]/page.tsx`
  - `src/app/communities/[slug]/home/page.tsx`
  - `src/app/discover/page.tsx`
  - `src/app/account/communities/page.tsx`
  - `src/components/communities/join-dialog.tsx`
  - `src/components/communities/discover-results.tsx`
  - `src/components/communities/invite-dialog.tsx`
  - `src/components/communities/invites-table.tsx`
- Modify:
  - `src/components/communities/community-editor.tsx` (Basics: description; Joining: rules textarea plus "Show in Discover" switch; People: invite dialog and table)
  - `src/app/workspaces/[tenantId]/communities/[communityId]/edit/page.tsx` (pass `invites` for managers)
  - `src/app/account/welcome/page.tsx` and `src/app/account/profile/page.tsx` (links "Discover" and "My communities", behind the flag)
  - `messages/en.json` (namespaces `CommunityPage`, `JoinDialog`, `CommunityHome`, `Discover`, `MyCommunities`, `CommunityInvites`; editor keys `description`, `rules`, `showInDiscover`)

**Interfaces:**
- Consumes: Task 3 services (server components call them directly) and Task 4 routes (client components `fetch` them with `origin` headers through the existing client fetch helper used by `community-editor.tsx`).
- Produces: UI only.

- [ ] **Step 1: Public landing** `src/app/communities/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { communitiesEnabled } from "@/server/communities-mode";
import { getPublicCommunity } from "@/server/community-joining";
import { optionalSession } from "@/server/page-session"; // add if missing: returns the session or null, never redirects
import { CommunityJoinCard } from "@/components/communities/join-card";
import { JoinDialog } from "@/components/communities/join-dialog";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ invite?: string }> };
export async function generateMetadata({ params, searchParams }: Props) {
  if (!communitiesEnabled()) return {};
  const c = await getPublicCommunity(getDb(), (await params).slug, (await searchParams).invite);
  if (!c) return { robots: { index: false, follow: false } };
  return { title: c.name, description: c.tagline ?? undefined, robots: c.visibility === "listed" ? undefined : { index: false, follow: false } };
}
export default async function CommunityPage({ params, searchParams }: Props) {
  if (!communitiesEnabled()) notFound();
  const { slug } = await params, { invite } = await searchParams;
  const community = await getPublicCommunity(getDb(), slug, invite);
  if (!community) notFound();
  const session = await optionalSession(), t = await getTranslations("CommunityPage");
  const canJoin = community.invited || community.allowOpen;
  return <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6">
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 space-y-6">
        <header className="space-y-2"><h1 className="text-[28px] font-semibold tracking-tight">{community.name}</h1>
          {community.tagline && <p className="text-muted-foreground">{community.tagline}</p>}
          <p className="text-sm">{t("by", { host: community.hostName })}</p></header>
        {community.description && <p className="whitespace-pre-line">{community.description}</p>}
        {community.rules && <details className="rounded-md border p-4"><summary className="min-h-11 cursor-pointer content-center font-medium">{t("rules")}</summary>
          <p className="mt-2 whitespace-pre-line text-sm">{community.rules}</p></details>}
      </section>
      <aside className="min-w-0">
        <CommunityJoinCard name={community.name} tagline={community.tagline} host={community.hostName} pricing={community.pricing}
          action={canJoin ? <JoinDialog slug={community.slug} rules={community.rules} rulesVersion={community.rulesVersion} invite={community.invited ? invite : undefined}
            signedIn={!!session} signInHref={`/sign-in?next=${encodeURIComponent(`/communities/${community.slug}${invite ? `?invite=${invite}` : ""}`)}`} /> : <p className="text-sm text-muted-foreground">{t("closed")}</p>} />
      </aside>
    </div>
  </main>;
}
```

  - Before writing this, check `CommunityJoinCard`'s current props (`src/components/communities/join-card.tsx`). If it takes no `action` slot, add an optional `action?: React.ReactNode` that replaces the preview-only disabled button, and keep the editor preview unchanged.
  - Check how `/sign-in` handles a return path (`grep -rn "next=" src/app/sign-in`). Use the existing parameter name; if there is none, link to `/sign-in` and note it in the acceptance record as a follow-up.

- [ ] **Step 2: `JoinDialog`** (client): a shadcn `Dialog` with:
  - the rules text in a scroll area (if any), a checkbox `acceptRules` (only if rules), a checkbox `adult` and a Join button;
  - Join is disabled until the required boxes are ticked;
  - POST `/api/communities/${slug}/join` with `{ rulesVersion, adult: true, invite? }`;
  - on 200 → `location.assign(/communities/${slug}/home)`;
  - on 409 with message `communityRulesChanged` → `router.refresh()` and keep the dialog open;
  - other errors → an inline `role="alert"` text;
  - when signed out, the trigger is a link to `signInHref`.

  Labels: `JoinDialog.join` "Join", `acceptInvite` "Accept invitation", `acceptRules` "I accept the community rules", `adult` "I confirm I am 18 or older", `title` "Join {name}".
- [ ] **Step 3: Member home** `src/app/communities/[slug]/home/page.tsx`:
  - `pageSession("personal")`; `isActiveMember(db, user, slug)`, redirecting to `/communities/${slug}` when it returns null;
  - render the heading, a "You're in." line, a link to the rules (back to the landing), and an empty state "Feed coming soon" (`CommunityHome.feedSoon`) using the existing empty-state component (`grep -rn "EmptyState" src/components | head -1`).
- [ ] **Step 4: Discover** `src/app/discover/page.tsx`: a server component that reads `q`, `open` and `after` from `searchParams`, calls `listDiscover`, and renders:
  - tabs, built with shadcn `Tabs` used as links: Communities (active), Courses, Products. The latter two are `aria-disabled` with a "Coming soon" badge.
  - `DiscoverResults` (client): a search input plus an "Open to join" switch that update the URL with `router.replace`, debounced 300 ms.
  - a card grid (`grid gap-4 sm:grid-cols-2 xl:grid-cols-3`) with name, tagline, host, a Free badge and a "View" link to `/communities/${slug}`;
  - an empty state; "Load more" as a link with `?after=next`.
  - It is public: render in a simple public frame (reuse the frame used by `/c/[publicCode]` pages for logo and theme; check `src/app/c/[publicCode]/layout.tsx` or the page wrapper and reuse it rather than duplicating it).
- [ ] **Step 5: My communities** `src/app/account/communities/page.tsx`: `pageSession("personal")`, `myCommunities`, and three `Card` sections:
  - Joined: link to home;
  - Invited: a `JoinDialog` with `inviteId`, so `JoinDialog` takes `inviteId?: string` and sends it instead of `invite`. `rules` and `rulesVersion` come from `getPublicCommunity` per invite; that is acceptable for small lists, capped at 20;
  - Hosted: link to `/workspaces/${tenantId}/communities/${id}/edit`.

  Each section has an empty state. Add links in the welcome and profile pages behind `communitiesEnabled()`.
- [ ] **Step 6: Editor additions** in `community-editor.tsx`:
  - Basics: a `Textarea` "Description (optional)".
  - Joining: a `Textarea` "Rules (optional)" and a `Switch` "Show in Discover", disabled unless the visibility is `listed`. Both are saved through the existing PATCH (add `description`, `rules`, `discoverOptIn` to the editable fields and the payload).
  - People (managers): an "Invite people" button (replacing the disabled Coming-soon button) opens `InviteDialog`. It takes an email, POSTs to `.../invites`, then shows the full link (`location.origin + path`) in a read-only input with a Copy button (`navigator.clipboard.writeText`) and the expiry.
  - `InvitesTable` lists masked email, status (translated) and expiry, with Revoke (DELETE) for pending invites.
  - The edit page passes `invites={writable ? await listInvites(...) : []}`.
- [ ] **Step 7: Copy.** Add every new string to `messages/en.json`. Run `npm run lint` (source guards reject hard-coded JSX copy). Expected: PASS.
- [ ] **Step 8: Typecheck and unit tests.** `npx tsc --noEmit -p . && npx vitest run --project unit`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(communities): public page, joining, Discover, my communities and editor invites`.

---

### Task 6: Browser test, evidence, records, PR, CI, review

**Files:**
- Create: `tests/e2e/community-joining.spec.ts`; screenshots `docs/screenshots/communities-pr3/`
- Create: `docs/acceptance/communities-c05-c06-c08.md`
- Modify:
  - `docs/decisions/0013-communities-architecture.md` (status line; §7 eligibility note: "listing requires an active Harvest subscription via `discoverEligible`; removal tool later");
  - `CLAUDE.md` (state: 0036 merged with PR 3, next candidate 0037);
  - `docs/setup/feature-flags.md` (list the new routes).

- [ ] **Step 1: Browser spec.** Reuse `signIn` and `shoot` (copy the `shoot` helper with `prepare` from `tests/e2e/community-editor.spec.ts`). One test, 300 s:
  1. Owner creates a ministry and a community through the API, PATCHes `{ allowOpen: true, visibility: "listed", discoverOptIn: true, rules: "Be kind.", description: "Weekly study." }`, then publishes.
  2. A second context signs in, opens `/discover`, searches the name, sees the card (`shoot discover`), opens it (`shoot landing`), clicks Join, sees Join disabled until both boxes are ticked, ticks them, joins, and lands on `/communities/<slug>/home` (`shoot home`).
  3. Owner changes the rules through the API. A third account opens the landing with a stale dialog (open the dialog, change the rules through the API, then submit) and sees "The community rules changed" with the new rules after refresh.
  4. Owner creates a hidden community and invites the third account's email in the editor People step: dialog → link shown (`shoot invite`). The third account opens the link and accepts → home. Reusing the same link → "This invitation isn't valid for your account."
  5. Owner invites a fourth email and revokes it in the table; the fourth account's link → invalid message.
  6. The third account's `/account/communities` shows Joined (2) (`shoot my-communities`).
  7. `expect(errors).toEqual([])`.
- [ ] **Step 2: Run the browser specs.** `timeout 590 npx playwright test tests/e2e/community-joining.spec.ts tests/e2e/community-editor.spec.ts --trace off`. Expected: PASS. Restore any screenshots outside `docs/screenshots/communities-pr3/` and `communities-c04/` with `git checkout -- <dir>`, then check `git status`.
- [ ] **Step 3: Look at the screenshots** (light and dark, phone and desktop) and fix layout issues.
- [ ] **Step 4: Run the full local suite:**
  - lint and typecheck;
  - all unit tests;
  - integration tests for `communities`, `community-joining`, `community-joining-db` and `workspace-audience`;
  - the restricted-owner suite as `tester`;
  - browser regression for `community-editor`, `campaigns`, `layout` and `account-*`.
- [ ] **Step 5: Records.** Write the acceptance doc covering scope, founder decisions, evidence, deferred items (join form with C07, Resend email with C15, removal tool, sitemap) and gates (no activation, production migrations 0031–0036 not applied). Update the ADR, CLAUDE.md and feature flags.
- [ ] **Step 6: Push and open a draft PR** to `main`, titled `feat(communities): C05+C06+C08 public pages, Discover, joining and invitations`.
- [ ] **Step 7: Start CI.**
  - **Final review:** CircleCI final review on the exact head (`full_review: true`, `expected_sha`, `pr_number`).
  - **Neon check, run from `main`:** because there is a migration, also start a run with config/checkout `main` and `neon_only: true`, `expected_sha`, `pr_number`.
- [ ] **Step 8: Independent review.** Ask the non-author reviewer session for an exact-head review. The focus areas:
  - the definer owner policies and GUC resets;
  - the invite oracle;
  - the rules race;
  - the projection invariants;
  - `myCommunities`' tenant setting;
  - the flag gating and the copy rules.
- [ ] **Step 9: Fix the findings, re-run CI and a delta review, then report to the founder.** No merge without explicit approval.
