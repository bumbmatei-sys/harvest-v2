# Communities PR 3 — C05 public pages + Discover, C06 joining, C08 invitations

Design: `docs/superpowers/specs/2026-11-11-communities-pr3-public-join-invites-design.md`. Plan: `docs/superpowers/plans/2026-11-11-communities-pr3-public-join-invites.md`. ADR 0013. Migration `0036_community_joining`.

## Founder decisions (11 Nov)

- **Discover:** a community appears when it is published, Listed, the owner turned "Show in Discover" on, and its ministry has a Harvest subscription. There is no pre-approval. A platform-admin tool to remove a listing and email the reason comes later. Until SaaS billing exists, `discoverEligible()` treats every ministry as eligible.
- **Invitations:** personal links. The owner copies the link and sends it themselves; Harvest-sent email (Resend) comes with notifications.
- **Joining:**
  - The owner's rules are optional. Joiners accept the current rules, if any, and confirm they are 18 or older.
  - An optional join form arrives with applications (C07), reusing the form engine.

## Delivered

- **Data (0036):**
  - communities gain `description`, `rules`, `rules_version` and `discover_opt_in`;
  - memberships record `rules_version_accepted` and `adult_confirmed_at`;
  - `community_invites` stores hashes only plus a masked hint, is one-time, expires after 14 days and can be revoked;
  - the `discover_listings` projection.
- **Access:**
  - The two new tables are FORCE RLS and staff-only. Visitors and members reach community data only through four `SECURITY DEFINER` functions: `community_public`, `community_enter`, `discover_communities` and `community_my_invites`.
  - These functions run under owner-only policies keyed on settings they set and clear, so they work without BYPASSRLS. Their execute rights go to the app role only.
  - Refusals are neutral: not found, a wrong-account, expired or revoked invite, and a banned person all get the same text.
- **Owner:**
  - The editor gains a description field, optional rules (a change bumps the rules version), a "Show in Discover" switch (enabled only for Listed communities), and invitations: a link shown once with Copy, a table with masked email, status and expiry, and Revoke.
  - Communities are limited to 50 per ministry.
- **Public and member pages:**
  - `/communities/:slug`: description, rules and a join card; "Accept invitation" when opened with a valid invite. Hidden communities show nothing without one; anything other than Listed is marked noindex.
  - The join dialog: optional rules acceptance plus 18+ confirmation. If the rules change while it is open, the person is asked again with the new rules.
  - `/communities/:slug/home`: member welcome with a "Feed coming soon" state.
  - `/discover`: the Communities tab with search and an "Open to join" filter in the URL, and paging. Courses and Products show "Coming soon".
  - `/account/communities`: Joined, Invited (accepted in place by invite id plus the verified email) and Hosted, linked from the account welcome page.
- **Sign-in:** a `next` parameter returns people to a community page. Only `/communities/<slug>`, optionally with an invite token, is accepted.
- **Flag:** everything above is off in production unless `HARVEST_COMMUNITIES=enabled` (`docs/setup/feature-flags.md`).

## Evidence (local, author-executed)

- Lint and source guards, typecheck, all unit tests (366, including flag-off 404s for the four new routes and the listing/invite helpers).
- **Integration (`community-joining-db`, `community-joining`, `communities`):**
  - visibility, the projection and opt-in;
  - joining refused for stale rules, no 18+ confirmation, closed admission and a banned person; joining is idempotent;
  - invites refused for the wrong email, after expiry, after revocation and on reuse; another ministry and viewers are denied;
  - no raw token or email is stored;
  - member and visitor RLS;
  - the community limit.
- **Restricted owner:** `community-joining-definer-owner` runs every new function with a non-superuser, non-BYPASSRLS owner holding only the migration's owner policies.
- **Upgrade suites:** the restricted-owner upgrade suites pass as the `tester` user. `hc03-definer-owner` now accepts INSERT-only owner policies (WITH CHECK, no USING).
- **Browser:** `community-joining` (Discover → landing → join with rules and 18+ → home; rules changed during the dialog; hidden community invite created in the editor; the wrong account is refused; accept from My communities; reuse → 404; revoke → 404). Axe and no horizontal scroll at 390/768/1440 in light and dark; screenshots in `docs/screenshots/communities-pr3/`.
- **Regression:** `community-editor` (C04 screenshots refreshed for the new fields), `account-onboarding`, `layout`, `connect-landing` (5), `pr03`, `hc07-invitations` (light and dark claim pass).
  - `HC-07 existing personal account` fails locally exactly as on a clean `main` (known; it passes in CI).

## Deferred

- The join form and applications (C07).
- Harvest-sent invitation email (C15).
- The platform-admin removal tool, including an email of the reason.
- Real subscription eligibility (billing).
- Request rate limits for the public pages, Discover and joining: no reusable limiter outside sign-in yet.
- Sitemap.
- Slug rename redirects.
- Discover categories, collections and saved items.
- Courses and Products tabs.
- `CommunityShell` and the feed (C09/C10).

## Gates

No merge, deployment or activation is authorized by this PR. Production migrations 0031–0036 are not applied. The HC-02 activation decisions are unchanged.
