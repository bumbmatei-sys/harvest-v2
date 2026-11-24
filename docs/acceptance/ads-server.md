# Ads server acceptance (fake provider only)

Migration `0098_ads_server`. Server only: no screens. Everything is hard-off (`ADS_INTEGRATION_ENABLED = false`, `ZERNIO_ADS_LIVE_NETWORK = false`), the only working provider is the in-memory fake, no real outbound call, no webhook registration, no spend, no real ad account. The five HC-02 gates stay UNAPPROVED. Sources: `docs/prd/professional-v1-launch-scope.md` (scope exception 20 Nov), `docs/prd/public-mode-social-discover-navigation.md` section 5.5, `docs/decisions/founder-decisions-2026-11.md` (Ads bullets), provider documentation read through the documentation search tool (field names; live behaviour unverified). Founder 25 Nov: cover the whole provider Ads surface behind the neutral adapter. Status key: BUILT / DEFERRED (reason) / N/A.

Checklist (ticked at the end with evidence in the "Evidence" column).

| # | Requirement (source) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Hard-off: literal-false constants, production never enabled, fake provider only, no network (PRD 5.5) | | |
| 2 | Owner/admin only, `ads:manage` in code and SQL, neutral 404 elsewhere (PRD 5.5) | | |
| 3 | Ad accounts linked through the existing social connection; ministry's own accounts; no ad payments handled (PRD 5.5) | | |
| 4 | Ad account health check with per-check `unknown`, last refusal and fix link (PRD item 10) | | |
| 5 | Needs-attention alerts: rejected ads, delivery issues, payment, spend without results, capped budget, lost connection (PRD item 10) | | |
| 6 | Campaign > ad set / ad group > ad read model, metadata only (ids, names, status, budget, schedule), no creative copy (PRD server paragraph) | | |
| 7 | Create campaign/ad set/ad: goals, budget amount/type/level, dates in ad-account timezone, default PAUSED, bidding, special ad categories (25 Nov) | | |
| 8 | Add an ad to an existing ad set (25 Nov) | | |
| 9 | Formats: image, video, carousel 2-10, document, event, text, messaging, call (25 Nov) | | |
| 10 | Boost a published post incl. list posts to boost, existing ad set, TikTok identities/Spark codes (PRD item 1) | | |
| 11 | Targeting incl. locations, radius pins, exclusions, languages, age, gender, interests, audiences, saved targeting, raw passthrough as opaque owner-only JSON, targeting search (PRD item 3) | | |
| 12 | Review-and-launch gate, validate-only (dry run), idempotent launch, never a second campaign on retry/ambiguous outcome (PRD server paragraph) | | |
| 13 | Political / social-issue ads refused until a policy exists (PRD open decisions) | | |
| 14 | Pause/resume at ad, ad set, campaign; bulk status; rename; delete/archive with irreversible warning (PRD item 9) | | |
| 15 | Budget/bid change with confirmation, stale-version protection, idempotency key; shared budgets (PRD item 9) | | |
| 16 | Audit of every spend-affecting action, ids/versions/outcomes only (PRD server paragraph) | | |
| 17 | Results per campaign/ad set/ad over a date range, metrics list, attribution model stored, newest value per day, "unavailable is not zero" (PRD item 8) | | |
| 18 | Results retention pruning | | |
| 19 | Review status per ad (in review/approved/rejected with reason) and delivery issues (25 Nov) | | |
| 20 | Lead forms: create/list, attach to lead_generation ads (25 Nov, PRD item 6) | | |
| 21 | Lead ingestion with statuses new/contacted/unreachable/qualified/converted/disqualified; stored as ad-lead records, NO CRM contact and NO implied consent until a person reviews (PRD item 6) | | |
| 22 | CRM contact creation from a lead | | |
| 23 | Audiences read model (custom, lookalike, saved, website, engagement) | | |
| 24 | Audiences built from CRM people / audience upload (PRD item 4, open decision: off until wording approved) | | |
| 25 | Conversions API / pixel: data model + adapter call shape only, nothing sent (PRD item 11) | | |
| 26 | Automatic ad rules, disabled by default, owner-configured, run log (PRD item 9) | | |
| 27 | Ads webhooks: verified signature, idempotent, fixtures only, no registration (25 Nov) | | |
| 28 | Scheduled background sync worker | | |
| 29 | Ad comments (inbox) | | |
| 30 | Creator-campaign ads (run creator posts as ads) | | |
| 31 | Breakdowns (age, gender, country, placement), async reports, Google keywords/search terms/keyword planner, labels (PRD item 8) | | |
| 32 | Erase/merge of contacts: nothing here references contacts | | |
| 33 | Neon / hosted verification, real provider scopes | | |

## Notes
- Provider-neutral wording: the vendor is not named in any user-facing string; ad networks are named only by their own names.
- Fields still to confirm against live provider behaviour are listed in `src/server/ads/zernio-ads-adapter.ts` (TODO block).
