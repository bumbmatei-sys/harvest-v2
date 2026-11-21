# Auto-DM screens acceptance

Screens for the merged Auto-DM server (`docs/acceptance/social-auto-dm.md`, #161). Sending stays hard-off (`SOCIAL_AUTO_DM_SENDER_ENABLED` is a literal `false`); the screens say so on every page and use the non-production fake provider only. All five HC-02 gates remain **UNAPPROVED**. Nothing here is approved, activated or deployed.

## What is built

- **Route and access.** `/workspaces/[tenantId]/social/auto-dm` (rules), `/new` and `/[ruleId]` (settings and activity). Owner and admin only (`social:auto_dm`); the pages answer 404 before any session work while the non-production gate is closed, and a neutral access state otherwise. The Public mode sidebar row "Auto-DM" is live with its own icon (`MessageCircleReply`, unique in the registry).
- **Routes use the gated deps.** `inbox-http.ts` and the Auto-DM and Inbox-hours routes now use `socialRouteDeps()` (the same change as the Inbox screens PR #176, identical text, so the merge is clean).
- **Rules list.** On/off switch per rule (turning on opens the enable review, turning off is immediate), counts (triggered, sent, skipped, handed off), last activity, aggregate tiles, empty, no-account, loading, error and unavailable states.
- **Rule editor.** Single page with five numbered steps (Trigger, Match, Response, Limits and hours, Review), a stepper overview, a live DM preview and test mode beside it. Trigger picker lists all eight triggers and shows unavailable ones with the reason (Instagram only, Facebook only, no verified live lookup). Post scope: any post, a Harvest post (planner deliveries) or a provider reference. Keywords, match mode, case, exclude and stop words, DM text with `{{firstName}}`, public reply, quick replies, media (image or video), follow-up (non-service purposes), cooldown, daily limits, working-hours behaviour and hand-off.
- **Enable review.** Asks the server for the ten-minute review of that exact version, shows the exact text, the service-only confirmation and the limits, requires "I have read the exact text", then enables with the token. Expiry, post-not-live, account and stale-version errors are mapped to plain text.
- **Test mode.** Matches a synthetic sample (fixed example first name) and can send to a disposable fake recipient; no account, person or network is involved.
- **Activity.** Counts and a log of fixed outcome codes (state, step, reason, version, short event id), with "load older". No message text or names exist to show.
- **Template review.** Every template with its service-only confirmation and an automatic promotional-wording flag (advisory, not a legal review). Editing a template drops the confirmation until it is given again.
- **Hours tab and sheet.** The account's working hours and away message, the same record the Inbox settings use.
- **Composer row.** "Auto-DM people who comment a keyword" in the option rows (Instagram and Facebook only). It needs a keyword, the reply and the service-only confirmation, and creates an **off** post-scoped comment rule for each Instagram or Facebook delivery after scheduling or publishing. The rule can be turned on once the post is live.

## Verified

- `npx tsc --noEmit` and `npm run lint` (including source guards) clean.
- Unit: `tests/unit/social-auto-dm-screens.test.ts` (trigger options and reasons, step issues, trigger switching, promotional flags and re-confirmation, count summary, composer rule, and every statically used message key exists), plus `navigation`, `ui-provenance`, `social-source-guard`.
- Playwright `tests/e2e/social-auto-dm-screens.spec.ts` (2 tests, both passing against the real routes and the fake provider): empty states; account select lists Instagram and Facebook only; unavailable triggers on both platforms with reasons; building a rule with the live preview; promotional flag; test match, no-match and fake send; save (rule is off); five rules via the API; seeded activity counts shown in the list and log; enable review refused for a post that is not live, then accepted; turn off; composer row blocks scheduling until complete, creates the rule, review refuses until the post is published; edit drops the confirmation and bumps the version; templates flag; hours saved; not-found; sidebar row. Axe (wcag2a, 2aa, 21aa), no horizontal overflow and no skeleton or busy region at 1280 and 360, light and dark, for every full page and overlay.
- Screenshots (device scale 2 at 360, 1280 wide) of: no accounts, no rules, rules list, editor (saved rule with preview and test mode), editor on a Facebook account (unavailable triggers), enable review dialog, activity log, templates, hours, hours sheet; each in light and dark at 1280 and 360 (40 images). All 40 were opened and none is blank or a skeleton.

## Not verified or not built

- The full-page editor screenshots are clipped at about 1900 px, so the Limits and hours and Review steps and the test result are asserted in the spec but not in an image.
- No integration test was added; the server's own tests cover the routes. Not run against hosted Neon.
- Media attach in the editor is built on the existing upload path but is not exercised in a browser.
- Hand-off offers only "me", "none" or the current person: there is no member-list route.
- The service-only confirmation is stored with the rule revision (audit log has the version); there is no separate approval endpoint. Legal review remains an activation gate.
- Per-rule counts use one request per rule (four at a time).
- Mode "any" is shown only if a loaded rule already has it (it matches like "contains").
- Real provider behaviour, real sending and every HC-02 decision are untouched.
- The Instagram and Facebook marks in the Auto-DM screens use the coloured variant of `platform-logo.tsx` added by #176 (merged). The composer option row keeps the shared monochrome marks.

## Kit items

Premium kit (admin-dashboard `1631106`): `pages/settings/notifications/page.tsx` is the reference for the bordered switch row in `src/components/social/auto-dm/editor-parts.tsx`. **Modelled on, not copied**; `scripts/ui-identical.sh`: 5 of 49 lines (10%, imports and closing lines). Everything else reuses existing Harvest components (Stepper, EmptyState, StatusBadge, Sheet, Dialog, StickySaveBar, option rows); no new kit item. Recorded in `src/lib/ui-provenance.ts` and `docs/ui-sources.md`.

## Improvements over the founder's first version (harvest-agent `SocialAutoDmView`)

- Server-backed rule versions with a disabled-by-default rule and an explicit, tokenised enable review (v1 had a plain switch).
- Trigger picker shows unavailable triggers with the reason (v1 hid them).
- Step editor with per-step status, a live DM preview with the variable filled, and test mode on a synthetic recipient.
- Per-rule counts by outcome, skipped-by-reason chips and a metadata-only activity log with fixed reason codes (v1 showed commenter names and text, which Harvest does not store).
- Service-only attestation, automatic promotional-wording flag and a template review tab.
- Working hours, away message, daily limits, cooldown and hand-off in the editor.
- A clear "sending is off" notice on every page; the composer creates the rule for you.
- Dropped from v1 because the server has no support: link click tracking, typo tolerance, follow-gating, rule deletion, Eden's Pro gate.
