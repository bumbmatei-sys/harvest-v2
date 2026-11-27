# Communities: public read throttles and About page accessibility (C23 follow-ups F1, F2)

Follow-up to the C23 release gate in open PR #303 (`docs/acceptance/communities-c23-release-gate.md` on `feat/comm-c23-hardening`). No migration. This approves no HC-02 gate, no production migration, no deployment and no real data; Communities stay hard-off in production.

## What changed

Anonymous public reads are throttled per visitor (`src/server/public-read-limit.ts`):

| Scope | Covers | Limit per visitor |
|---|---|---|
| `discover` | `GET /api/discover` (listing), `GET /api/discover/listings` (search) and the `/discover` page, one shared budget | 60 a minute |
| `community-page` | the public page `/communities/:slug` (metadata and page share one charge per request) | 60 a minute |
| `community-beacon` | `POST /api/communities/:slug/count` (the page's anonymous visit/join beacon) | 60 a minute |
| `community-unsubscribe` | `POST /api/communities/unsubscribe` | 10 a minute |

The limits match the existing per-visitor public limits: link-in-bio clicks (60 a minute per visitor and page) and sign-in's one-time-code limit (10 a minute). Discover search in the browser runs only on filter changes and "Load more", so 60 a minute leaves room for normal browsing.

- **Visitor key.** The same keyed-hashed key the link-in-bio and give-page report limits use (`bioVisitorKey`): the client address from sign-in's configuration (`AUTH_IP_ADDRESS_HEADERS`, `AUTH_TRUSTED_PROXIES`), HMAC'd with a key derived from the server secret. On Workers it uses the request scope's secret and `cf-connecting-ip`. No raw address is stored or logged. No usable address means no key and no counting, as for those routes.
- **Store.** The existing `rate_limits` table that sign-in's database rate limiter uses, under a `public-read:` key prefix; one row per visitor and scope with a one-minute fixed window. Expired `public-read:` rows are swept on about one request in fifty, so a hashed key lives about a minute. No new table, no migration.
- **Answer.** The neutral `{ "error": "rate_limited" }` 429 with `Retry-After` (seconds left in the window, 1 to 60) and `Cache-Control: no-store`, as hosted forms and the giving reports answer. A page cannot answer 429, so over the limit `/communities/:slug` shows a neutral "Too many requests. Try again in a minute." notice and is never indexed, and `/discover` shows its existing failed state (legacy page: empty state). Nothing is read from the database in either case.
- **Order.** The hard-off checks still come first (production 404 unchanged). The limit is charged before any slug or token is looked at.
- **Unsubscribe stays uniform.** The charge happens before the token is read, so under the limit every token kind (valid, forged, expired, garbage, missing, JSON body) gets the same `200 { ok: true }`, and over it every kind gets the same 429. Nothing is processed over the limit.
- **Failure.** If the limiter itself fails, the read is served and `public_read_limit_failed` is logged (no visitor data).

About page accessibility (F2, About part): `tests/e2e/community-forum.spec.ts` "about" test runs axe (WCAG 2.2 AA tags) at 1280 and 360, light and dark, checks no horizontal scroll, and measures every visible link, button and field at 360: all are at least 44 by 44. No violations were found, so no markup changed. Screenshots: `docs/screenshots/communities-pr4b/about-{desktop,phone}-{light,dark}.png`.

## Evidence

- `tests/integration/public-read-limit.test.ts`: the limiter (window, per visitor, per scope, count cap, reset, sweep, no raw address, Workers key); Discover listing, search and page sharing one budget, 429 after it and fine before it, another visitor unaffected, no counting without an address; the community page's neutral notice and noindex metadata over the limit, another visitor unaffected; the beacon 429 for existing and missing slugs alike; unsubscribe's identical answers under and over the limit for every token kind, nothing processed over it, another visitor unaffected.
- `tests/e2e/community-forum.spec.ts` "about: axe at 1280 and 360, light and dark, 44px actions".

## Resolved after #303

These rows of `docs/acceptance/communities-c23-release-gate.md` are resolved by this PR; update them when both PRs are on main:

| Gate row | Was | Now |
|---|---|---|
| 11.6 Anonymous Discover reads are rate limited | GAP open (F1) | PASS: `discover` scope, 60 a minute per visitor |
| 15.6 The anonymous unsubscribe endpoint and public community page are throttled | GAP open (F1) | PASS: `community-unsubscribe` 10, `community-page` and `community-beacon` 60 a minute per visitor |
| 18.3 axe on the About page | GAP open (F2) | PASS: 1280 and 360, light and dark, 44px targets |
| F1 follow-up | open | resolved |
| F2 follow-up | open | About part resolved; the screen-wide 44px sweep across all member screens (18.5) stays open |

## Not done

- A platform firewall rule per address (the alternative F1 named) was not added; that is an infrastructure choice outside the app.
- The `rate_limits` rows left by sign-in's own limiter are not swept here (unchanged behaviour).
- The screen-wide 44px sweep (18.5) beyond the About page.
