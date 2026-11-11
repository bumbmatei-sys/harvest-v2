# HC-08 — Free-account onboarding and profile (design)

Status: design approved by the founder on 11 Nov 2026. Implementation plan: `docs/superpowers/plans/2026-11-11-hc-08-free-account-onboarding.md`.

Slice contract (`docs/prd/harvest-connect-slices.md`): *Free identity/profile, purpose preferences, onboarding. Done when an account activates and preferences work while choosing no community.* Dependencies HC-07 (verified claim, merged) and HC-06 (linked-response completion, merged).

## Founder decisions (11 Nov)

1. **Path choice:** show all four options (`Find a free community`, `Start a Bible course`, `Find a church`, `Explore later`). Only `Explore later` is selectable; the other three are disabled and marked "Coming soon". Nothing is stored about them.
2. **Preferences scope:** account-level choices only. Consent withdrawal and response deletion stay on the existing response-rights page (`/connect/rights`), linked from the welcome page. No consent switches here (that is HC-14).
3. **Directory visibility:** not stored in HC-08. HC-09 adds it when the directory exists.
4. **When shown:** once after a new account claims an invitation, skippable, and afterwards reachable from the welcome page and the profile page. Existing accounts are never forced through it.
5. **Storage:** approach B, a new `user_profiles` table (below).

## What exists today

- `/account/welcome` (personal frame): starter resources, profile link, optional return, response rights, sign out.
- `/account/profile`: language only, through `ProfileForm`.
- `users.name` (required by auth), `users.locale`.
- Invitation claim completion returns `/account/welcome` (`src/server/connect-invitations.ts`).
- Production intake and invitation delivery remain hard-disabled; HC-08 does not change that.

## Design

### Data (migration 0034, `0034_user_profiles`)

```
user_profiles
  user_id                  text primary key references users(id) on delete cascade
  city_region              text null, check (length between 1 and 200)
  onboarding_completed_at  timestamptz null
  onboarding_skipped_at    timestamptz null
  updated_at               timestamptz not null default now()
```

- FORCE row-level security. The app role can select, insert and update only the row where `user_id = current_setting('app.user_id')`. No delete grant; rows go with the account (cascade).
- No tenant column: a free account is a platform identity, not a ministry member.
- **Backfill:** the migration inserts one row for every account that exists when it runs, with `onboarding_skipped_at = now()`. Those accounts count as having been offered onboarding, so they are never redirected to it; it stays reachable from the welcome page. Only accounts created after the migration start as pending (no row). This is what makes "existing accounts are never forced" true, because the claim flow does not know whether an account is new.
- The display name stays in `users.name`, the language in `users.locale`. No religious-status field. No directory-visibility field.
- Generated with drizzle-kit; the migration test asserts only `public.user_profiles` changes. Next candidate number follows the journal on main (0033 is the last).

### Server (`src/server/account-profile.ts`)

- `getAccountProfile(db, userId)` returns `{ email, name, locale, cityRegion, onboarding: "pending" | "completed" | "skipped" }` (no row means pending).
- `saveOnboarding(db, userId, raw)`: strict zod `{ name: trimmed 1–100, locale: enum(locales) | null, cityRegion: trimmed 1–200 | null }`, updates `users.name`/`locale`, upserts the profile row, sets `onboarding_completed_at`.
- `skipOnboarding(db, userId)`: upserts the row with `onboarding_skipped_at` (a completed account stays completed).
- `updateAccountProfile(db, userId, raw)`: same fields, does not change onboarding timestamps. It replaces the language-only `updateProfile` for the personal page; the existing ministry-side profile page keeps working.
- All run in `withUser`. Errors reuse the existing message catalog; no email or name in errors or logs.
- API: `PUT /api/account/profile` and `POST /api/account/onboarding` (`save` and `skip`), with the existing session and origin checks.

### Screens (shadcn, shared `PublicFrame personal`, full width, 44px targets below `lg`)

- **`/account/onboarding`:** `AccountProfileFields` (name, language select, optional city), then a path RadioGroup. `Explore later` is selected; the other three options are disabled with a "Coming soon" badge and are not focus targets that look actionable. Buttons: `Save and continue` and `Skip for now`, both going to `/account/welcome` (preserving a safe `from` path through `safeSourcePath`).
- **`/account/profile`:** the same `AccountProfileFields`, saved through the profile endpoint.
- **`/account/welcome`:** accounts whose onboarding status is `pending` are redirected to `/account/onboarding` (keeping a safe `from` path). Once skipped, the page shows a `Finish setup` link. The response-rights link stays. The invitation claim service and its tests are unchanged: the redirect happens on the welcome page, which also covers people who sign in directly. An account that existed before the migration has a skipped row (backfill), so it goes straight to the welcome page. The redirect rule is only "onboarding status is pending".
- Copy stays concise: no explanatory paragraph under fields; the city field is labelled "City (optional)". Provider-neutral wording; "ministry" wording unaffected.

### Reuse

Extends `PublicFrame`, `ProfileForm` (its language field moves into the shared fields component), shadcn `Input`, `Select`, `RadioGroup`, `Badge`, `Button`, and the personal-session page pattern. No one-off form.

### Privacy and safety

- Only the person's own data; no tenant or staff access to `user_profiles`.
- City is voluntary and free text within a length bound; no religious data is collected.
- The page is `noindex`, `referrer: no-referrer`, `force-dynamic`, like the other personal pages.
- Abandoning onboarding never blocks resources: the welcome page and `/resources/start` do not depend on it.
- Account erasure removes the row by cascade; no copy exists elsewhere.

### Tests and evidence

- Integration (`tests/integration/account-profile.test.ts`): save/skip/update; a user cannot read or write another user's row (RLS, including through raw SQL as the app role); length and trim limits; skip after complete keeps complete; name/locale updates land in `users`; migration 0034 applies on a fresh and an upgraded database, and the backfill marks pre-existing accounts as skipped while accounts created afterwards are pending.
- Unit: schema validation, status derivation, claim-redirect decision.
- Browser (`tests/e2e/account-onboarding.spec.ts`): claim → onboarding → save → welcome; skip path; revisit from the welcome page; disabled "Coming soon" options are not selectable; profile edit; axe and no horizontal scroll at 390/768/1440 in light and dark; screenshots viewed. Existing invitation and welcome specs updated for the new landing.
- Independent review by a separate fresh session; CircleCI final review with the Neon migration check (PR #53's flow if merged by then).

## Out of scope

Consent switches and queued-message cancellation (HC-14), directory visibility (HC-09), working community/course/church destinations (HC-09–12 and the church directory), notification preferences (HC-11), case or counselor features (HC-13).

## Gates

No merge, deployment or production migration is authorized. Migrations 0031–0033 are still unapplied in production, and 0034 would follow them. The five HC-02 activation decisions remain unapproved; HC-08 collects no new data from guests and the production intake stays disabled.
