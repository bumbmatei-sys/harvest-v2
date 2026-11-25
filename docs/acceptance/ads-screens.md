# Ads screens acceptance

Stacked on the Ads server branches (`feat/ads-server` #232, `feat/ads-crm` #239, `feat/ads-forms-source` #240). Screens only: no new provider call, no real ad account, no spend. Everything stays hard-off: the screens answer 404 in production (the non-production social gate, `ADS_INTEGRATION_ENABLED` stays the literal `false`), and in development and tests they run against the in-memory test provider with invented accounts, campaigns, results, leads and posts (`src/server/ads/seed.ts`, reachable only through the open gate). Founder 25 Nov: "build the ads in the style of an ads manager: a 3-level table Campaign, Ad set, Ad; and ad creation like in the platform". Structure only is copied; no network branding, colour, icon or copy. Kit approvals: `docs/ui-sources.md` (Ads screens) and `adsKitApprovals`.

## PR 1: Ads manager (this change)

Route `/workspaces/[id]/social/ads`, nav item **Ads** (target icon) in Social media between Auto-DM and Analytics, owner and admin (`ads:manage`).

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Summary cards: spend, results, cost per result, reach, with the Social Analytics range picker (7, 28, 90 days or custom) | BUILT | Shared `StatCard` and `RangePicker` reused. Reach is shown **per day (average)** because the server never totals reach across days; a measure nobody reported reads Unavailable, never zero. Unit tests. |
| 2 | Tabs Campaigns, Ad sets, Ads with counts; selecting rows on one level filters the next | BUILT | `visibleRows`, `pruneSelection` (unit); e2e selects a campaign, then an ad set. |
| 3 | Per-row on/off switch, confirm when it can start spending | BUILT | Turning on asks first (dialog); turning off does not. Versioned, idempotent calls; refused or stale changes show a message. e2e. |
| 4 | Name with status and review state, delivery, budget, results, cost per result, reach, impressions, spend, ends | BUILT | Delivery reads the review result and delivery issue before the switch and a past end date as Completed (`deliveryOf`, unit). |
| 5 | Totals row | BUILT | Shared `DataTable` gained an optional `totals` row (table) and summary block (cards). e2e. |
| 6 | Columns picker: Performance, Delivery, Engagement, Custom | BUILT | `ColumnsMenu`; Custom has one checkbox per column; columns that do not apply to a level are dropped. e2e. |
| 7 | Bulk on/off | BUILT | Up to the server's 50; turning on asks first. e2e. |
| 8 | Name opens the right-side edit panel | BUILT | Rename, delivery switch, budget and end date (campaign, ad set) with an explicit confirmation of the spend change, review result (ad), remove with an irreversible warning. e2e. |
| 9 | Account selector and account health banner | BUILT | One banner for account status, failing or warning health checks with fix links, the last refusal and open alerts (dismissible). e2e. |
| 10 | Phone layout is cards | BUILT | Shared `DataTable` card layout; 44px targets asserted. e2e. |
| 11 | Empty and error states, find ad accounts through the connected social account | BUILT | e2e. |

Guided create and Boost a post are PR 2 and lead forms and leads are PR 3 (below).

## PR 2: guided create (nine steps) and Boost a post

**Reworked 25 Nov to the founder's workflow:** CAMPAIGN 01 Create (new campaign, a new ad in an ad set that exists, or boost a post), 02 Objective, 03 Budget; AD SET 04 Ad set (name and bid strategy), 05 Audience, 06 Placements, 07 Schedule; AD 08 Ad, 09 Publish. The steps sit in the shared step list under the group labels Campaign, Ad set and Ad (a new optional `group` on the shared step components), finished steps carry the green check (#250) and the group markers use the gold chart token. The Objective step has the buying type on top (auction, the only one the server accepts), then the objective rows (radio, icon tile, label) beside a detail panel (illustration slot, title, one line, Good for chips; a generic explainer before a choice; under the list on a phone). `ObjectiveArt` (`src/components/ads/objective-art.tsx`) is a neutral placeholder with a fixed props contract for the code-drawn illustrations. Cancel and Continue are in the footer. Flows that do not need a step show it disabled (an added ad has no objective or budget; a boost has no ad step). Server: optional `adSetName` on the campaign payload. Validation, the launch gate and the idempotency key are unchanged.

Route `/workspaces/[id]/social/ads/new` (also `?mode=boost`, `?account=`, `?request=`). Header buttons **Create ad** and **Boost a post** on the manager.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Steps: goal, ad set (audience, placements, budget daily or lifetime, schedule), ad (format, media, text, headline, link, button, lead form picker), review and launch | BUILT | In the shared `EditorShell` with `WizardLayout`. A boost has no Ad step. e2e. |
| 2 | Live ad preview beside the form | BUILT | `AdPreview`; a column from 1280px, a sheet below. e2e asserts it follows the text, link and button. |
| 3 | Validation from the server | BUILT | The form uses the server's own schemas (`problems`, unit) so a field is flagged where the server would refuse it; the Review step then runs the server's dry run (validate only) and shows its refusal reasons. The refused political category is flagged. e2e. |
| 4 | Launch through the review and launch gate | BUILT | Check (validate), then Launch: review of the exact payload, then launch with one idempotency key kept for the whole attempt. An unclear outcome offers Try again with the same key, so a second campaign is never created. Starts paused unless Active is chosen. Asks first. e2e. |
| 5 | Autosave draft | BUILT | Saved on this device always, and as a launch request on the server as soon as the form is complete enough for the server to accept it (versioned, one write at a time). A reload restores it. e2e. |
| 6 | Boost a post | BUILT | Posts that can be boosted come from the account; goal, audience, budget, optional existing ad set. e2e. The Planner and Queue "Boost" action is not added here. |
| 7 | Media | BUILT | Images and video go through the Planner's private upload (hashed, inspected, scanned); the ad carries the file id. A type that is not allowed never uploads. The browser run answers the storage steps itself. |
| 8 | Formats | BUILT: image, video, carousel, text, messaging, call. Event and document formats are not offered. | Unit. |

Server notes: `placements` (automatic, or a chosen list) was added as an optional field of the campaign and boost payloads (`src/lib/ads/ads.ts`); the test provider's validate step now accepts a payload whose lead form id was swapped for the provider's reference (it rejected every lead-goal ad before).

## PR 3: lead forms and leads

Routes `/workspaces/[id]/social/ads/leads` (tabs Lead forms and Leads) and `/social/ads/leads/forms/[formId]` (the builder). Reached from **Lead forms and leads** on the manager and from the lead form picker in the create flow.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Lead forms list | BUILT | Forms built in this app (drafts, with the number of published versions) and the forms already on the ad account, in the shared `DataTable`. e2e. |
| 2 | Builder entry point reusing the shared forms builder with the `ads` preset | BUILT | "New lead form" asks for the network and a privacy policy link (the server builds the starting form: name, email, phone and the notice). The builder is the shared `BuildCanvas` question builder and `PublicForm` preview, with an ads side panel: privacy link, which question collects which standard answer, the three optional consent questions (each its own unticked box, never bundled), the issues that block publishing, and publish to an ad account. Editing a published form starts a new version. e2e. |
| 3 | Publishing | BUILT, hard-off | `ADS_LEAD_FORM_PUBLISH_ENABLED` stays the literal `false`; only the non-production gate's test provider turns it on (`features.leadFormPublish`), so production still answers 404 and the screen says publishing is not turned on. |
| 4 | Leads list with convert-to-CRM action | BUILT | Status change (six statuses), filter by status, refresh from the account, **Add to CRM** for one lead, for the selected ones or for all new ones (each lead is matched on email or phone, never overwritten, and gets no consent from the conversion itself), delete with an irreversible warning. A lead shows **In CRM** afterwards (`inCrm` added to the lead view). e2e. |
| 5 | Personal data | UNCHANGED | Leads stay ad-lead records until a person adds them; the five HC-02 privacy decisions and the wording of the consent questions remain UNAPPROVED (see the server acceptance). The browser run uses invented example addresses and numbers only. |

## Reuse and exceptions

Reused: `AppShell` and the typed nav registry, `DataTable` (extended with `totals`), `StatCard`, `RangePicker`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `Sheet`, `Alert`, `Switch`, `DropdownMenu`. New Ads-only pieces are compositions of those; nothing duplicates a shared component.

## Evidence

- Unit `tests/unit/ads-screens.test.ts` (table model, copy keys, kit approval record), `navigation.test.ts` (Ads is live).
- E2E `tests/e2e/ads-leads.spec.ts` (lead forms, builder, publish, leads, add to CRM, delete), shots `lead-forms-*`, `lead-form-builder-*`, `leads-*`.
- E2E `tests/e2e/ads-create.spec.ts` (create, boost, lead goal, image upload, phone), same axe and screenshot rules, shots `create-*` in `docs/screenshots/ads/`.
- E2E `tests/e2e/ads-manager.spec.ts` with axe (WCAG 2.0 to 2.2 A and AA) and no horizontal overflow at 360, 768 and 1280, light and dark; screenshots in `docs/screenshots/ads/`.
