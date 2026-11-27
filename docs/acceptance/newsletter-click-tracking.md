# Newsletter link-click counting

Migration `0126_newsletter_click_tracking`. Newsletter sending stays hard-off in production, nothing real is sent, and there are no real webhooks. All five HC-02 gates remain **UNAPPROVED**. Production migrations are unapplied.

## Founder decisions (26 Nov 2026) and how they are met

| Decision | Where |
| --- | --- |
| Clicks only. No open tracking, no pixel. | Only content links are rewritten. Nothing is added to the message body except one footer line. |
| Totals only: per campaign, per UTC day, top links per campaign. Groups under 5 hidden. Owners and admins only (`newsletter:analytics`). Nobody can see who clicked. | `public.newsletter_click_report` is the only read path. The app role has no grant on the click tables. No API, screen or export returns a delivery, person or address. |
| Off by default per ministry. The owner turns it on in the newsletter settings. When on, the sign-up page and the email footer say links are counted. | `newsletter_settings` (no row means off). Sender page section "Link clicks" with an owner-only switch. Footer line and hosted sign-up line: "This ministry counts link clicks in its emails, as totals only." |
| Click rows kept 90 days, then rolled into anonymous campaign/day/link counters. No IP address, user agent or device data. | `newsletter_purge_clicks`, run by the same `newsletter:purge:test` command and `HARVEST_NEWSLETTER_RETENTION_ENABLED` flag as the delivery purge. The click tables have no such columns, and the redirect never reads request headers. |
| Bot and scanner clicks are labelled honestly. A GET never changes subscription state. | The tile reads "Link clicks" with "May include link scanners". The footer says the same. HEAD requests redirect without counting. The redirect definer writes only `newsletter_clicks`. |

## How it works

1. **Setting.** `newsletter_settings(tenant_id, click_tracking, click_tracking_since, version, updated_at)`. A guard trigger sets `click_tracking_since` from the database clock when counting is turned on, and clears it when counting is turned off. The guard also enforces version + 1. The app can read the setting as owner or admin. Only the owner can insert or update it, enforced by RLS through `public.access_role`. The server checks the same rule first (`saveNewsletterClickSettings`, `PUT /api/workspaces/:id/newsletter/settings`). Turning counting on or off is audited (`newsletter.settings.click_tracking`).
2. **Send time.** `newsletter_delivery_authorize` is the 0109 body plus `campaignId`, `revision` and `clickTracking`. `clickTracking` is true only when counting was on at the moment the campaign was frozen (`click_tracking_since <= frozen_at`) and is still on. The worker renders once to collect the content links. Then `newsletter_click_links_store` (worker only) stores the frozen revision's links by position and returns the list. The worker renders again with each listed link replaced by `/api/newsletter/link?t=<token>`.
3. **What is rewritten.** The renderers call the rewrite hook for content links only: rich-text links, buttons, image links, video links and social links. The unsubscribe link, the `List-Unsubscribe` headers, image and logo addresses and the preview are never rewritten. Automation emails and test sends are not rewritten (see Deferred).
4. **Token.** `src/lib/newsletter-click-token.ts`. The payload is version, ministry, campaign, delivery, revision and link position (55 bytes, base64url). It is signed with HMAC-SHA256 using the injected newsletter token key and its own purpose string (`newsletter-click-v1`). The token never carries the address or the URL.
5. **Redirect.** `GET /api/newsletter/link?t=…` verifies the signature. `public.newsletter_click` then reads the URL from `newsletter_click_links` for that frozen revision, so the URL never comes from the request. The definer records at most one row per delivery and link (`ON CONFLICT DO NOTHING`), and only while counting applies and the delivery record still exists. The route returns 302 with `no-store` and `Referrer-Policy: no-referrer`. An invalid, tampered, foreign-key or unknown token, or a database failure, goes to the neutral page `/newsletter/link`. The route returns 404 in production like the other newsletter routes.
6. **Reports.** `public.newsletter_click_report` (owner and admin, `access_role`) returns the total, the days, the campaigns and up to 10 links. A campaign-day under 5 withholds that day, the period total and that campaign's row, the same differencing rule the delivery analytics use. A campaign sent to fewer than 5 recipients never shows clicks. Links under 5 are omitted. If that leaves one link, or fewer than 5 clicks, unaccounted for, the smallest shown link is omitted too, so no small figure can be found by subtraction.
7. **Retention.** `newsletter_purge_clicks(limit)` runs as the worker only. In one statement it deletes click rows older than 90 days and adds them to `newsletter_click_counts`, which holds campaign, revision, UTC day, link position and count. Reports read both tables.

Security notes: every new definer pins `search_path=pg_catalog,pg_temp`, schema-qualifies names, saves and restores each `app.*` setting it changes, and checks roles only through `public.access_role`. All four tables use FORCE RLS. Grants are revoked from PUBLIC, `harvest_app` and `harvest_worker`, except the settings grants above. Nothing is backfilled, because all tables start empty, so the 0091 NO FORCE pattern is not needed.

## UI

- Sender page (`/newsletter/sender`) has a "Link clicks" section with the shared `Switch` and `Label`, one consequence line, and "Only the owner can change this." for admins. The label is the 44px tap target.
- Analytics overview has a "Link clicks" tile, a clicks line in the daily chart and a sortable Clicks column once counting is on or clicks exist. The footer reads "Link clicks are totals and may include link scanners; opens are not collected." When counting is off it reads "Opens are not collected. Link clicks are counted only when the owner turns it on."
- Campaign analytics has the same tile, a clicks line, and a "Top links" card that uses the shared `DataTable` with Link and Clicks columns.
- Hosted sign-up page shows one muted line under the form when the ministry counts clicks. This line sits beside the recorded consent wording and is not part of it, so `newsletter-consent-v1` is unchanged.
- The review preview shows the footer line when counting is on.
- Reuse: `ReportStatCards` (now 4 columns for 7 tiles), `ReportTrendCard`, `DataTable`, `Card`, `Switch`, `Label`. **No new kit items**, no new shared component and no provenance change.

## Evidence

- Unit: `tests/unit/newsletter-click-tracking.test.ts`, 6 tests. Covers token round trip and rejection of tampering, other keys and malformed input. Covers rewriting of every content link in block documents and legacy content, with unsubscribe, image and logo addresses never rewritten. Covers no change when counting is off, the cap and unknown links.
- Integration (restricted migration owner, fake transport, fetch refused): `tests/integration/newsletter-click-tracking.test.ts`, 10 tests. Covers:
  - table shape: forced RLS; no IP, agent, device or person columns; grants; pinned definers; `access_role`; the app cannot read click rows even after setting `app.nl_send_tenant`
  - off by default
  - owner-only setting: admin reads but is refused, members, viewers and other ministries are refused, and RLS blocks an admin's direct insert
  - a real worker send with rewritten links, untouched unsubscribe and footer line, and the redirect returning 302 to the frozen URL
  - HEAD does not count, a repeated GET is idempotent, and no subscription or consent changes
  - tampered, foreign-key, unknown-link and other-ministry tokens go to the neutral page
  - totals, day and campaign figures, with top links under the complementary rule
  - access for owners and admins only, the definer refusing members and other ministries, cross-ministry isolation, and no settings left behind
  - small day, period total, campaign row and small-cohort suppression
  - the 90-day roll-up and delete, which is worker only, flag gated and limit checked, and still reported
  - turning counting off stops rewriting and counting, and turning it on again does not count a campaign frozen earlier
  - the hosted form manifest `clicksCounted`
- Existing suites updated: `tests/integration/newsletter-analytics.test.ts` (campaign rows carry `clicks`) and `tests/e2e/newsletter-analytics.spec.ts` (7 tiles, reworded footers).
- E2E: `tests/e2e/newsletter-click-tracking.spec.ts`. The owner turns counting on in the UI. A sent campaign is seeded as synthetic delivery rows in the disposable database. Eleven signed clicks go through the real redirect, including a repeat and a forged token. Analytics shows 11 and the top links. Axe and no horizontal scroll are checked at 360 and 1280 in light and dark. Screenshots: `docs/screenshots/newsletter-click-tracking/`.

## Deferred and decisions needed

- **Automation emails, test sends and the preview are not rewritten.** Counts are per campaign. Automation emails do not carry the footer line because they are not counted.
- **The hosted sign-up line is outside the consent wording.** If the founder wants it inside a recorded wording, that needs a new immutable wording version (`newsletter-consent-v2`).
- **Clicks count once per delivery and link.** They are not unique people and they include scanners. A click that arrives after the delivery record expires at 90 days from selection is not counted, but the link still redirects.
- **Small-group rule.** Days and campaigns are suppressed as described above. Top links use the complementary rule. Revisit if the delivery analytics rule changes.
- **Not done:** no export, no member access, no per-link trend, no opens.
- **Clock.** The database sets `click_tracking_since`, while `frozen_at` is the app server's time at dispatch. Large clock skew between them could misjudge a campaign frozen within seconds of turning counting on.
