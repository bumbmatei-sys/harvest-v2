# Connect retention and erasure jobs (HC-DEC3 and HC-DEC4 engineering)

Design: `docs/superpowers/specs/2026-11-13-hc-retention-erasure-design.md`. Plan: `docs/superpowers/plans/2026-11-13-hc-retention-erasure.md`. Migration `0043_connect_retention`. Database and server only.

**This builds toward the founder's selected directions (13 Nov 2026). It approves nothing.** All five HC-02 activation gates stay UNAPPROVED, and every number below is an engineering default pending legal review. Real collection, real invitation delivery and deployment stay hard-disabled.

## Delivered

- **Policy in one place:** `public.connect_retention_policy()` (30-day maximum for unverified entries, 90-day tombstone period, small-group minimum 5, 26-hour health window), mirrored in `src/lib/connect-retention.ts`. A test fails if the two differ.
- **Maximum retention:** a trigger on `form_versions` refuses a new or changed `pending_retention_days` above 30. Shorter is allowed and published versions are untouched. The intake schema and the form-settings input use the same maximum, so the API answers 400 and the browser stops at 30.
- **The sweep, `connect_retention_sweep(limit)`:** all ministries, any mode, bounded batch, `SKIP LOCKED`.
  - Erases every expired pending or associated response into a day-level tombstone with the existing scrub.
  - Deletes tombstones older than the tombstone period together with their redacted consent rows.
  - Each row runs in its own subtransaction: a row that cannot be handled (a lock held elsewhere, an unexpected child row) is counted and skipped, so it never stalls retention for everyone else, and the run is recorded as `failed` with `row_failed` and the counts it achieved.
  - Writes one row to `connect_retention_runs` (status and counts only: no ministry, response or person) and prunes run rows after 90 days.
- **Alerting:** `connect_retention_record_failure(code)` records a failed run in a fresh statement (a failed sweep rolls back its own log row); `connect_retention_health()` returns the last success, the last status, `overdue` (no success within the window) and `failedSinceSuccess`.
- **Job:** `npm run connect:retention` loops the sweep until a batch finds nothing or reports failed rows (capped at 50 batches) and prints counts; failed rows make the job exit 1. `npm run connect:retention -- check` prints the health and exits 1 when overdue or failed. Both run as the application role.
- **Small groups:** `connect_suppress_small(n)` and `suppressSmall(n)` return nothing for counts of 1 to 4. **No aggregate report over responses or tombstones exists yet, so this has no consumer today; HC-15 must use it.**

## The guard change

`guard_campaign_response()` and `guard_campaign_response_consent()` used to refuse every DELETE. They now allow it only when all of these hold: the row is an erased tombstone older than the tombstone period (consent: redacted evidence of such a tombstone), the caller owns the erasure definers (`connect_erasure_writer()`), and the transaction-local setting `app.connect_retention` is `on`, which only the retention functions set and clear. Everything else in both guards is as in 0032. The application role has no DELETE grant and no access to the run log. A new owner-only SELECT policy on `campaign_responses` lets the sweep find expired rows across ministries; each row is then handled under that ministry's own tenant policies.

## Evidence (local)

- `npx tsc --noEmit`, lint and source guards on the changed files: clean.
- Unit: `connect-retention` (3).
- Integration: `hc-retention-db` (13: a row that cannot be deleted is skipped and the run recorded as failed, the application role refused even with the setting on and a tombstone past the period, policy equals TypeScript, maximum on insert and update, legacy untouched, two ministries, fresh versus old tombstones, consent rows removed with no orphans, two sweeps at once, deletion refused without the setting or before the period, no application access, health states, 90-day log, counts only) and `connect-retention` (3: batch loop and cap, failure recorded outside the failed statement, health).
- Restricted-owner (as the non-superuser `tester`, FORCE RLS applying to the owner): new `hc-retention-owner` runs intake, invitation, verified claim and CRM association, then expiry, tombstone and deletion, and checks that none of the ten tables that reference a response keeps a row. The policy function is executable by any role (constants only), so restricted-owner fixtures need no extra grant.
- Regression: HC-02, HC-03, HC-05, HC-06B, HC-06C and HC-07 suites and connect-landing, 121 tests, plus all restricted-owner and upgrade suites.

## Decisions and limits

- The sweep is deliberately not limited to synthetic mode: it only deletes expired data and must keep working when real collection is eventually activated. The older `purge_connect_intake` (synthetic only) still handles intake-specific housekeeping and is unchanged.
- The sweep functions are granted to the application role. They return counts only and only delete expired data, so the cross-ministry address exposure raised for the email worker (#72) does not apply. Code running as that role could still call `connect_retention_record_failure` and falsify the health signal; the dedicated worker role (C15b activation gate) should own these too.
- Caps for verified records, the owner of the monitor, and the choice of the actual numbers are open until legal review.
- A form version published before this change keeps a retention above 30 days.

## Activation gates

- Schedule `npm run connect:retention` daily (it is bounded, so more often is fine) and `npm run connect:retention -- check` hourly, with the check's non-zero exit wired to an alert (the alert channel is not chosen).
- Legal review of the numbers (30, 90, 5), then record each decision in `docs/decisions/hc-02-activation-gates.md`.
- Production migration 0043 after 0042; not applied.

## Review follow-up (non-author review of `02ffd53`: CHANGES-REQUESTED, two should-fix items)

- **One bad row stalled the whole sweep:** fixed with a subtransaction per row, failures counted and logged as a failed run, and the job stopping after a failed batch so a later empty batch cannot hide it.
- **Missing tests:** the application role with the setting on against an old tombstone, and a tombstone that had rows in every table that references a response (full verified path, restricted owner).
- **Optional, taken:** `finished_at` uses `clock_timestamp()`; the policy function is executable by any role, and the fixture grant was removed.
- **Optional, recorded:** the health signal can be written by the application role until the dedicated worker role exists.
