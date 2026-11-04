# PR 01a workflow contracts and evidence

| Flow | Success | Error | Empty | Unauthorized |
| --- | --- | --- | --- | --- |
| Request code | Mocked/real adapter sends six-digit code; UI advances | Invalid email, provider failure, 60-second cooldown, per-email rolling cap (5/hour, 20/day), or HTTP limit appears as an alert | Email form with labelled field | Public sign-in only; other OTP purposes and auth mechanisms rejected |
| Verify code | User/session persisted; audit recorded; workspace page opens | Wrong, expired, replayed or exhausted code rejected | Code field appears after request | No session until code verification succeeds |
| List workspaces | Only verified memberships and tenant rows shown | Error boundary with retry | First-workspace prompt | Session required; signed-out navigation redirects |
| Create workspace | Workspace, owner membership and audit commit together | Validation/DB/audit failures roll back, UI alert | Empty form | No client-selected owner/tenant; anonymous and cross-origin mutations denied |
| Add member/change role | Existing user gets tenant-qualified membership; append-only audit | Unknown user, last-owner demotion and invalid roles rejected | No member invitation/send flow | Member/viewer denied; admins cannot change ownership; no foreign workspace access |
| Tenant data access | Only verified tenant context visible | Foreign writes rejected; callbacks never run without membership | No context returns zero tenant records | Server sessions and membership checks gate context |

PR 01a evidence (2026-11-04; merged as `d136f7b`):

- Unit tests: permission matrix and unavailable payment adapter.
- Local PostgreSQL integration: actual Better Auth/Drizzle persistence, mocked Resend, expiry, five wrong attempts, single-use codes, code rotation, per-email cooldown, persistent HTTP limit, session logout and audit.
- RLS: tenant read/write isolation, forged workspace denial, immutable audit, audited-write rollback, restricted app role, and pool context reset after commit/rollback with matching backend PID.
- Neon dev: migration applied; five live RLS checks pass. Both pooled and direct app-role traffic verified; only synthetic dev seeds created, no email sent.
- Playwright Chromium: real UI → auth handler → PostgreSQL → session → workspace API → persisted reload → logout. Sign-in and workspace axe checks report zero violations. Desktop and mobile screenshots are captured under `test-results/` and uploaded by CI.
- Lint/typecheck/build and final test totals are recorded in the draft PR.

Limits: live email delivery was intentionally not exercised. EMAIL_FROM must be configured with the existing verified sender. Neon CI requires repository secrets and fails when either is absent; live Neon RLS tests remain opt-in and are not part of CI. Staging/prod migration verification, product owner sign-off, contacts, shell, dual-theme screenshots and theme switching are outside this PR 01a implementation. No deployment is performed.

Committed screenshots: [sign-in](pr01a/sign-in.png), [empty workspaces](pr01a/workspaces-empty.png), [created workspace](pr01a/workspaces-created.png), [mobile](pr01a/workspaces-mobile.png). PR 01a local totals: 6 unit + 19 PostgreSQL integration + 5 Neon integration + 1 Playwright journey, all passing. Lint, strict typecheck, production build, and repeated dev migration also pass.

Remote CI: the earlier workflow-upload blocker was resolved before PR #1 merged. [Foundation CI PR run 2](https://github.com/bumbmatei-sys/harvest-v2/actions/runs/41825341640) on `cfdce128cd5597ad256cafe07f5d1306b1d53946` completed successfully, including lint, typecheck, unit tests, build, PostgreSQL migrations/RLS, Playwright/accessibility, and Neon CI migrations. The review confirmed that this PR run created, migrated, and removed a Neon CI branch. The earlier push run skipped Neon work when secrets were absent; PR 01c changes that condition to a failing job.

PR 01c auth hardening validation (2026-11-04):

- `npm run lint`, `npm run typecheck`, and `npm test`: pass; 6 unit tests.
- `npm run test:rls`: pass; 27 PostgreSQL integration tests, including auth and RLS. The local fixture applies migrations twice and uses the real `harvest_app` role with Resend mocked. A separate local upgrade check confirmed that an existing cooldown row retains its last issuance in the new rolling history.
- Auth regressions cover atomic parallel hourly issuance, the rolling daily cap and window expiry, at most 25 guesses across five issuances before the hourly issuance cap blocks new codes, ten parallel wrong guesses on separate connections with an observer recording every committed increment and no more than five counted attempts, single-use/expiry/rotation, immediate retry after provider failure, and a delayed failure preserving a newer code/cooldown.
- Hash verification covers HKDF-SHA256 domain separation from `BETTER_AUTH_SECRET`, HMAC-SHA256 over a canonical email/code tuple, and rejection of a hash copied to another email. Existing outstanding codes hashed under the previous scheme become invalid after an upgrade and require a new request.
- HTTP regressions cover missing, malformed, and untrusted multi-hop IP headers failing before any rate-limit row or email is created, plus independent buckets for two clients behind configured proxies. Spoofed leftmost hops and unconfigured headers do not change the selected client.
- `npm run build` and `npm run test:e2e`: pass. The Chromium journey verifies sign-in through the Next.js auth route, session/workspace persistence, logout, and zero axe violations against local PostgreSQL with mocked email. Chromium was selected from the writable `/tmp/harvest-playwright` browser cache after the default cache lacked an executable.
- The actual Neon CI configuration shell block was exercised with both secrets absent, each individually absent, and both present using mock values: missing configuration exits 1, complete configuration exits 0. No credentials are printed.
- PR 01c does not rerun the opt-in live Neon dev tests or apply migrations to a live database. The prior five live Neon RLS checks above remain historical evidence; staging verification is still outstanding.

Ingress configuration for the deploy target:

- `AUTH_IP_ADDRESS_HEADERS` is an ordered comma-separated list of client-IP headers that the ingress overwrites; default `x-forwarded-for`. Configure only headers the client cannot supply through the deployed ingress. For example, a Cloudflare-only origin can select `cf-connecting-ip`; a reverse proxy can overwrite a dedicated client-IP header.
- `AUTH_TRUSTED_PROXIES` is a comma-separated list of exact proxy IPs/CIDRs. For a forwarded chain, Better Auth walks right to left, skips those proxies, and selects the first untrusted address. Empty means only single-value IP headers are accepted. Do not trust broad networks containing clients, and restrict direct access to the origin.
- All auth HTTP requests require a resolvable trusted client IP. Missing, malformed, or unresolved headers return HTTP 503 before Better Auth's limiter, so they never consume a shared fallback bucket. Server-side `auth.api` calls still enforce the per-email issuance cap and per-code attempt limit; they are not IP-limited.
- Failed deliveries release the matching cooldown/issuance reservation and remove its undelivered code. Reservation matching prevents a late failure from clearing a newer send. Successful and in-flight sends count toward rolling caps; a superseded failed reservation remains conservatively counted until it ages out.
