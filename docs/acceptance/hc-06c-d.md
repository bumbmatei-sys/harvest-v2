# HC-06C + HC-06D — Source and permission segmentation, integrated closeout

Implementation date: 10 November 2026. Combined slice approved by the founder in this task ("Build it and regarding sms and email, build it best on best practices"). Based on merged HC-06B1–B3 / PR #46. No migration. This record does not authorize merge, production migration, intake, invitation delivery or deployment.

## Approved decisions

1. One PR for C and D.
2. Source rules are for Organization owners and admins only (`contacts:sources_read`), the same capability that already protects source history.
3. Newsletter and follow-up permission filters are available to every CRM reader, like the existing Marketing email filter.
4. A shared saved view that carries source rules is hidden from members. A direct link to it shows an empty, locked list with a notice, never every contact. The view's name and rules never reach the member: the default view stands in for it in the menu, header and chips.
5. Export adds a Sources column only when the Source column is shown, and only for owners and admins.
6. Merged contacts keep the existing fail-safe newsletter suppression (an opt-out on either merged record survives the merge). Documented and covered by a test; no behavior change.

## Delivered behavior

### Source rules (HC-06C)

- One rule says: include or exclude contacts whose source events match all of its conditions on the **same** event. Conditions: which source (any, first or latest), source type (Connect, Manual, CSV import, Unknown), and for Connect only: campaigns, links, forms and entry route (QR route or short link), plus an inclusive UTC date range.
- Included rules are a union; any matching excluded rule removes the contact. Up to five rules. Unknown means a contact with no retained source events and stands alone (no other conditions).
- Rules live in the URL (`s=mode~match~kinds~campaigns~links~forms~route~from~to`), saved views, list, export count and export file through one shared predicate, so list = count = export.
- Reverted events and Connect evidence whose response is expired or no longer associated never match (the existing RLS policy is the only reader).
- Fail closed: the capability is checked before any source SQL runs; a rule that names a campaign, link or form outside the Organization or no longer present returns an empty locked list with a notice instead of falling back to the default view. Companies reject source rules.
- UI: an icon-only Filters popover (shadcn Popover, Command, Checkbox, ButtonGroup, NativeSelect). A "Source" group with a "Source rule" entry appears only for owners and admins. The rule editor shows campaign, link, form and route only when Connect is the only type chosen; links narrow to the chosen campaigns. Archived campaigns and links stay choosable and are labelled as archived. Draft rules are staged with the other filters and applied together. Active rules show as chips with edit and remove. No "Advanced filters" wording, no per-field helper text, 44px tap targets below `lg`.
- Source choices load from `GET /api/workspaces/:id/crm/sources/options` (owner/admin, `private, no-store`, at most 500 of each, public codes never returned: an unlabeled link is named "Untitled link · campaign name", never its short code).

### Permission filters (HC-06C)

- New filters: Newsletter, Follow-up email and Follow-up SMS, each Granted, Withdrawn or No decision, beside the existing Marketing email filter in a "Contact permissions" group.
- Follow-up is split by channel because consent is per channel: email consent is governed by GDPR/ePrivacy (PECR) rules and SMS by separate rules such as the US TCPA, so a yes to one channel must never read as a yes to the other.
- The effective decision follows the existing consent rule: an unsuperseded withdrawal wins unless a later grant beats it on both recorded and occurred time; redacted evidence never counts.

### Integrated closeout (HC-06D)

- The claim flow cookie is now cleared when a claim is confirmed or declined. Errors (wrong account, lost race, server error) keep it so the person can retry. A repeated confirm after success finds no flow (409) and changes nothing; the continuation endpoint falls back to the welcome page.
- The flaky HC-06B expiry test no longer races a 1.2 second real-time expiry: the fixture publishes with a future expiry and moves it into the past inside its own transaction.
- `docs/acceptance/hc-07.md` no longer says the claim creates no CRM contact without noting HC-06B.
- New browser acceptance spec `tests/e2e/hc06c-d-integrated.spec.ts`: a real Connect claim, a manual contact, a source rule through the UI, list/count/export agreement with and without the Sources column, exclude, a missing-reference lock, the channel permission filters and the cleared cookie, with axe and no horizontal scroll at 390, 768 and 1440 wide in light and dark. It writes screenshots to `docs/screenshots/hc06c-d/`.
- `tests/e2e/hc06b-association.spec.ts` now expects the post-claim replay to be refused (409) with no cookie left.

## Validation provenance

All evidence below is author-executed in the writing session. Independent review must be a separate, fresh session.

- `tests/integration/hc06c-source-filters.test.ts`: 10 tests passed (real Connect flow fixture; kinds, campaign/link/form/route, same-event correlation, first/latest, union and exclude, UTC dates, list = count = export, Sources column rule, member/viewer/revoked-admin refusals, foreign and missing references, companies, locked shared views and notices (name and rules not exposed to members), unlabeled links never show their short code, consent withdrawal/re-grant/SMS-only/redaction, merged-contact newsletter suppression).
- `tests/integration/hc06b-foundation.test.ts`: 27 tests passed with the rewritten expiry fixture.
- New unit tests: `hc06c-source-rules` (4) and `hc06d-claim-cookie` (2) passed.
- Full suite, lint, typecheck: see the PR description for the final run on the pushed head.

## Known limits

- **Browser tests and screenshots were not run in the writing environment**: it has no browser and browser downloads are disabled. The browser specs run only in CircleCI's manual final review (`full_review=true`), not on routine PR pushes. That job kept artifacts only on failure; PR #49 keeps the screenshots from every run. Until then, screenshots need a local run (`npx playwright test tests/e2e/hc06c-d-integrated.spec.ts`).
- No 50k-contact query benchmark was run. Source predicates are correlated `exists` subqueries per contact on `contact_sources_history (tenant_id, contact_id, occurred_at, id)`, which already exists; add an index in a later migration only if a measured plan needs one.
- A saved view whose stored state is corrupt still falls back to its full default state (pre-existing behavior).
- Persistent global Do not contact remains out of scope.

## Remaining release gates

All five HC activation decisions remain unapproved. Production migrations 0031 then 0032 are not applied. Production intake and real invitation transport remain hard-disabled. HC-08 onboarding and HC-13 case lifecycle remain separate. No merge or deployment is authorized.
