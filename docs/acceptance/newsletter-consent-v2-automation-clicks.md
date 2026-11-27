# Newsletter consent wording v2 and automation link clicks

Migration `0135_newsletter_consent_v2`. Founder decisions of 27 Nov 2026 (to be recorded in `docs/decisions/founder-decisions-2026-11.md` by PR #309). Newsletter sending stays hard-off in production, automations stay behind their flags, nothing real is sent and there are no real webhooks. All five HC-02 gates remain **UNAPPROVED**. Production migrations are unapplied.

## 1. The "links are counted" line is part of the recorded consent wording

| Decision | Where |
| --- | --- |
| New immutable wording `newsletter-consent-v2`: the v1 statement plus "This ministry counts link clicks in its emails, as totals only." | `src/lib/newsletter-signup.ts` (`newsletterWordings`, `CLICKS_COUNTED_LINE`). v1 is unchanged and pinned by a unit test. |
| v2 is recorded when the ministry counts link clicks at the moment of sign-up; v1 when it does not. | `newsletter_form_signup_start` (replaced in 0135) reads `newsletter_settings` inside the same statement that records the sign-up and stores `wording_version` = v2 or v1. The confirmation grant's evidence carries that id, as before. |
| Old v1 grants are untouched. History is never rewritten. | No backfill, no update of `newsletter_form_signups`, `contact_consents` or subscriptions. Integration test compares an earlier v1 person's grant and subscription rows before and after counting is turned on. |

How it works:

- A form is still saved and published with `newsletter-consent-v1` (the form schema accepts only v1). v2 is never stored on a form; it is chosen at sign-up. This keeps the existing preset contract: a published form's frozen texts never change.
- The hosted page manifest (`GET /f/:slug`) returns the wording that applies now. While counting is on, the consent label and `newsletter.consentText` are the frozen v1 text plus the clicks line, which is exactly v2 stamped with the ministry name the form was published with. The separate muted line under the form is gone, because the line is now inside the consent the person ticks.
- The page posts back the wording it showed (`wording`). If that is not the wording that applies now (the owner switched counting after the page loaded), the server returns 409 and the page reloads the form, with the box unticked, so the person agrees to the words that will be recorded. The database applies the same rule itself: `newsletter_form_signup_start` records nothing when `p_wording` differs from the wording it computes, so a setting changed mid-request can never record words the person did not see; the server then also answers 409 so the page reloads.
- The builder's read-only Consent wording section adds one line: which version is recorded while clicks are counted, and the line it adds.

### Assumption for the privacy review (not decided here)

**If a ministry turns counting on later, existing subscribers keep their v1 grant and are not asked again.** The reasoning: counting is totals only (per campaign or automation, per day, per link, groups under 5 hidden), no per-person click data is readable by anyone, and no IP address, user agent or device data is collected, so it adds no new processing of the person's data beyond the newsletter they already agreed to. Their emails do carry the footer line "This ministry counts link clicks in its emails, as totals only." This is an engineering assumption for the privacy reviewer and the founder to confirm or overrule; it is not a legal opinion. If it is overruled, the options are a re-permission campaign or not rewriting links for v1 subscribers, both of which need their own decision.

## 2. Automation emails count clicks under the campaign rules

| Rule | Where |
| --- | --- |
| Links are rewritten only when the ministry has counting on. | The automations worker renders once to collect content links and calls `newsletter_automation_click_links_store` (worker only). It returns NULL unless the email's attempt is the run's current one and counting was on when the email was authorised (`click_tracking_since <= log.at`). Only then are links rewritten and the footer line added. |
| Totals only per automation, per step, per UTC day and per link. | `newsletter_automation_click_report(tenant, automation, from, until)` returns `total`, `days`, `steps` and up to 10 `links`. No row identifies a person. |
| Groups under 5 hidden. | Same differencing rule as campaigns with the step in the campaign's place: a step-day under 5 hides that day, the period total and the step; a step whose emails reached fewer than 5 people never shows clicks; links count only clicks of shown steps, so a link total never exceeds the shown step totals and a withheld step or day cannot be found by subtraction; links under 5 are left out, and the smallest shown link too when that leaves one link or fewer than 5 clicks unaccounted for. |
| Owners and admins only. | The report checks `newsletter:analytics` through `public.access_role`; `automationClicks` uses `withNewsletter(..., "newsletter:analytics")`. Members, viewers and other ministries are refused. The app role has no grant on any click table. |
| Records kept 90 days, then the roll-up. | `newsletter_purge_automation_clicks(limit)` (worker only, `HARVEST_NEWSLETTER_RETENTION_ENABLED`, run by the existing `purge` action) deletes rows older than 90 days and adds them to `newsletter_automation_click_counts` in one statement. Reports read both. |
| No IP or device data. | The tables have no such columns, the redirect never reads request headers, and HEAD requests redirect without counting. |

Details:

- Tables: `newsletter_automation_click_links` (automation, position, URL; unique URL per automation, at most 200), `newsletter_automation_clicks` (automation, attempt, step, link, time; one row per email and link), `newsletter_automation_click_counts` (automation, step, day, link, count). All FORCE RLS, revoked from PUBLIC, `harvest_app` and `harvest_worker`, reachable only through the definers. New index `newsletter_automation_log_attempt_idx` on the existing log.
- Token: version 2 of the existing 55-byte signed click token (`signAutomationClickToken`): ministry, automation, attempt and link position, never the address or the URL. A campaign token and an automation token can never be read as each other. The same `/api/newsletter/link` route serves both.
- The step a click belongs to is read from the email's log entry, never from the token. A click counts only while that log entry exists (a person's erasure removes it) and counting has stayed on since the email was sent; turning counting off and on again does not count earlier emails.
- Definers pin `search_path=pg_catalog,pg_temp`, schema-qualify names, save and restore each `app.*` setting they change by name (never `pg_settings`), and check roles only through `public.access_role`. Nothing is backfilled (the tables start empty), so the 0091 NO FORCE pattern is not needed.

UI: the automation editor's Activity tab now starts with a "Link clicks" section (owners and admins): the shared `ReportStatCards` tile ("May include link scanners", or "Not counted"), `ReportTrendCard` clicks by day, `ReportBarsCard` clicks by step ("Step 2: Welcome") and the same "Top links" `DataTable` card as campaign analytics, with the 90-day footer. **No new kit items**, no new shared component, no provenance change.

## Review fix: campaign top links (0126 report)

`newsletter_click_report` is replaced in 0135 with its exact 0126 body except one condition: top links now count only clicks on days that are shown (`r.day NOT IN (SELECT day FROM small_days)`), as well as excluding small cohorts. Before, a campaign with a withheld day still counted that day's clicks in its link totals, so the links could reveal it. The complementary rule is unchanged. Regression: `tests/integration/newsletter-click-tracking.test.ts` ("never lets a campaign's link totals reveal a withheld day").

## Evidence

- Unit: `tests/unit/newsletter-signup.test.ts` (v2 wording pinned, `signupWording`, `signupTexts`, a form cannot store v2) and `tests/unit/newsletter-click-tracking.test.ts` (automation tokens round trip and never verify as campaign tokens, and the reverse).
- Integration `tests/integration/newsletter-consent-v2.test.ts` (restricted migration owner, fake sink, fetch refused), 6 tests: v1 pinned and v2 = v1 + line; v1 recorded and granted while off; v2 shown (label, consent text, notice text) and recorded and granted while on, with the form still frozen at v1; earlier v1 grant, subscription and sign-up rows unchanged; mismatched or missing wording refused with 409 and nothing sent, and the database refusing a mismatched wording on its own in both directions; one pinned definer with the new signature and every `app.*` setting restored.
- Integration `tests/integration/newsletter-automation-clicks.test.ts`, 8 tests: table shape, grants and definers; off leaves links and footer untouched and stores nothing; on rewrites content links only (unsubscribe untouched, footer line), HEAD does not count, GET counts once per email and link, step from the log, forged, other-key, unknown-link and other-ministry tokens go to the neutral page; owner and admin totals per step, day and link, members, viewers and other ministries refused; small step (3 recipients) and small step-day (4 clicks) withheld with their links; two steps where one step-day is under 5, with link totals never above the shown step or day totals (review regression); turning counting off stops counting and turning it on again does not count earlier emails; the 90-day roll-up and delete, worker only, flag gated, limit checked, and still reported.
- Existing suites still pass: every `tests/integration/newsletter-*.test.ts`, the click-tracking and sign-up forms e2e specs.

## Deferred

- No click figures for automations on the newsletter analytics overview (only on the automation's Activity tab).
- Steps are numbered by their position when the email was sent; reordering steps of a paused automation later does not move earlier clicks.
- Test sends and the preview are still not rewritten.
- The clock caveat from campaign click counting applies: the database sets `click_tracking_since`, the log time is the authorising transaction's start.
