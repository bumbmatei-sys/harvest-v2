# HC-16 bounded backend regressions

Baseline `6080cb6` (16 Nov 2026). Companion gap record: `docs/acceptance/hc-16.md` in the separate readiness-record draft. This slice adds **tests and this record only**. No application source, schema/migration, shared harness, dependency, CI, shell/UI, catalogue or screenshot change. **HC-16 release readiness remains incomplete.** All five HC-02 gates remain UNAPPROVED; production collection/delivery remain disabled and migrations 0031+ unapplied.

## Exact workload

`tests/integration/hc16-load-security.test.ts` uses `testDatabase({migrationOwner:true})` on a disposable local PostgreSQL database. It verifies the actual migration owner is neither superuser nor BYPASSRLS. A separate application-role pool holds **eight simultaneous physical connections**, proved by distinct backend PIDs; it does not mistake the shared harness's single-connection queue for concurrency. Fixed bounds, no configurable remote/HTTP target, no provider calls; global fetch is spied and must remain unused.

- Eight workers each perform 25 synthetic counter transactions: **200 increments**, split 100/100 across two ministries. Exact counter values and suppressed service projections must agree; no lost update or cross-ministry contribution.
- Eight workers each alternate ten unknown-code and ten non-synthetic captures: **160 refusals**, with zero counter rows for the target. This checks transaction-local synthetic mode does not survive pool reuse.
- Five valid captures with a forged tenant hint count only against the code's authoritative ministry. Tenant/user/mode settings are empty after commit; a later non-synthetic capture is refused.
- A writer holds five increments uncommitted while another connection reads metrics: the reader sees the previous committed five, then ten after commit. Explicit transaction barriers, no sleeps; response fields are exactly the fixed metric allowlist.
- Twelve rounds interleave owner reads with member/viewer denials, cross-ministry unknown-campaign denial and a direct application-role SQL denial, reusing the service's physical backend.

`tests/unit/hc16-suppression-adversarial.test.ts` covers residual cohorts 1–4 across multiple case states, unsafe numeric input and 160 deterministic vectors. Its independent cohort oracle compares associated responses with every union of mutually exclusive case states; it does not copy the implementation's generic subset-sum algorithm. Released vectors must retain exact values without exposing any related small complement; generated cases exercise both release and suppression.

## Running / interpreting results

Focused commands: `npm test -- tests/unit/hc16-suppression-adversarial.test.ts` and `npm run test:rls -- tests/integration/hc16-load-security.test.ts`. Existing automatic unit/integration discovery includes both files; CI configuration is unchanged. Final full lint/typecheck/unit/integration/build results and exact head are recorded in the draft PR.

After a successful burst, the test writes only connection/operation counts and elapsed/p50/p95/max milliseconds into a fresh temporary `hc16-local-evidence-*/scan-burst.json` artifact. No codes, URLs, credentials, tenant/user IDs, response content or visitor data are recorded. Observed author timings belong in the PR; reruns vary and do not rewrite a committed benchmark. Test timeouts are stall guards, **not** performance acceptance thresholds.

This is a bounded database regression, not an HTTP crowd benchmark, a throughput certification, a latency SLO, or a full queue/backlog/withdrawal-race suite. Existing HC-13/14 suites retain their lifecycle coverage; no new result is inferred for them. It does not test real delivery, hosting capacity, load shedding, bot defense, mobile/4G, browser/axe, restore, scheduler/alerts, legal adequacy or safeguarding. A separate release-scale workload and thresholds require review. No Neon run is required for this migration-free diff; Neon-specific performance is unverified. Fresh engineering review and CI evidence remain separate from release signoffs.
