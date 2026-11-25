# Discover server acceptance (unified communities, courses, products)

Migration `0100_discover_server`. Server only, no screens. Hard-off: `DISCOVER_SERVER_ENABLED = false` (literal), the unified routes open only inside the non-production gate that Public mode screens already use. The legacy communities-only Discover endpoint (`/api/discover`, `discover_communities`) is untouched. The five HC-02 gates stay UNAPPROVED.

Sources read: `docs/prd/harvest-communities.md` section 8A (who decides what appears, filters and sort, cards, data structures, APIs, acceptance criteria) and 4/7, `docs/decisions/0013-communities-architecture.md` section 7, `docs/decisions/founder-decisions-2026-11.md`, `docs/prd/professional-v1-launch-scope.md`, `CLAUDE.md` Communities decisions (public pages `/communities/:slug`), existing code (`discover_listings` projection and `syncListing` from 0036, the free catalogue 0061/0067). The PRD asks for platform approval; the 11 Nov founder decision in ADR 0013 says "no pre-approval, platform-admin removal later". This slice follows the coordinator's brief (a review queue) and records the conflict as a founder decision below. Status and Evidence are filled after the build.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Hard-off literal flag, neutral 404, non-production gate only; legacy endpoint unchanged | | |
| 2 | Reuse canonical records: projection rows derive from communities and `catalog_items` (course, download=product); nothing duplicated or owned by Discover; a community's opt-in stays its canonical column | | |
| 3 | Owner opt-in per item (course/product control row; community canonical), owner/admin only, default not listed | | |
| 4 | Owner metadata: category (fixed taxonomy), language | | |
| 5 | Platform review: pending queue, approve (bound to the exact public fields), reject with reason, suspend with reason, reinstate | | |
| 6 | Re-review on material change (name, summary, category, language, price, host, audience): approved and rejected listings return to pending; never visible while pending | | |
| 7 | Ministry standing: a suspended ministry has no listing visible | | |
| 8 | Unlist: opt-out, unpublish, hidden/unlisted remove the listing at once | | |
| 9 | Public search: q, type, category, language, audience (host), free, sort (relevance/newest/name), bounded offset pagination, facet counts per type | | |
| 10 | Only published + listed + opted-in + approved (for the current fields) + ministry not suspended; enforced again at read time in SQL | | |
| 11 | Minimal public fields only: no tenant id, member, enrolment, application, payment or pastoral data | | |
| 12 | Report a listing: signed-in, one open report per person and listing, ten a day, reporter hidden from the ministry; platform report queue and resolve | | |
| 13 | Audit (ids, states, reasons) for opt-in, metadata, decisions, standing | | |
| 14 | Owners cannot approve, reject, suspend or edit reviewer fields (database trigger), even by direct SQL | | |
| 15 | Platform-admin identity | | |
| 16 | FORCE RLS on the new tables, definer functions with fixed search_path and REVOKE FROM PUBLIC, `TO PUBLIC` definer policies, platform functions granted to the worker role only | | |
| 17 | Saved items, collections, recommendations, sitemap/cache purge, price ranges, level/duration/delivery filters, size bands, verified badge, `available_to_user` | | |
| 18 | Public routes and screens under `/discover`, destination pages | | |
| 19 | Contacts: nothing references contacts | | |

## Founder decisions needed (recorded, not guessed)
1. **Approval versus no pre-approval.** PRD 8A.3 requires platform approval; ADR 0013 section 7 (11 Nov) says no pre-approval. This slice implements the review queue and requires `approved` for the unified search. The legacy communities-only endpoint still lists opted-in communities without review. Choose one rule before the screens ship.
2. **Platform-admin identity.** No platform-admin model exists (no table, role or claim). The review functions are therefore granted only to the worker database role and exposed as service functions that take a worker connection; no web route can call them. The PRD endpoint `POST /api/platform/discover/reviews/:id/decision` is not built until the model is decided.
3. **Audience filter.** The canonical records carry no audience, so the filter uses the owning ministry's audience (church, ministry/nonprofit, evangelist/missionary, creator) copied into the projection and covered by the material-change hash.
4. **Category taxonomy and languages.** A fixed 12-key list and two or three letter language codes; the PRD's localised, moderated taxonomy table is not built.
5. **Ministry suspension** is a Discover-only standing (a visibility switch), not a billing or account suspension. Active-subscription eligibility (ADR 0013) still defaults to eligible until billing exists.
