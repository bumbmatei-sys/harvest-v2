# Connect retention and erasure jobs (HC-DEC3 and HC-DEC4 engineering, design)

Status: approved by the founder on 13 Nov 2026 (directions from the HC-02 decision sheet: 30-day maximum for unverified entries, a short-lived coarse tombstone, small groups hidden; tombstone period 90 days; small-group threshold fewer than 5). Plan: `docs/superpowers/plans/2026-11-13-hc-retention-erasure.md`. Migration `0043_connect_retention`.

**All five HC-02 activation gates stay UNAPPROVED.** This builds toward the selected directions only. Real collection, real invitation delivery and deployment stay hard-disabled. Database and server only: no screen changes.

References: `docs/acceptance/hc-02.md` §1 (retention), §3 (rights hooks), `docs/decisions/hc-02-decision-sheet.md`, `docs/decisions/hc-02-activation-gates.md`.

## What exists today

- A response expires at `expires_at = submitted_at + the form version's retention`. Expired pending or associated responses are erased into a day-level tombstone (`status = 'erased'`) by `purge_expired_connect_responses` (one ministry, owner/admin) and by `purge_connect_intake` (all ministries, but only in synthetic mode and only for responses with an intake receipt).
- Tombstones are never removed. Nothing limits the retention a form version may choose (1 to 36500 days). Nothing records or alerts on purge runs.
- The database refuses every DELETE on a response and on consent evidence ("erased, not deleted"; "append-only").

## Policy (one place)

`public.connect_retention_policy()` returns the numbers; `src/lib/connect-retention.ts` mirrors them and a test fails if they differ.

| Value | Number | Meaning |
|---|---|---|
| `max_pending_days` | 30 | Longest retention a form version may set for unverified entries. Shorter is allowed. |
| `tombstone_days` | 90 | How long an erased tombstone is kept before it is deleted. |
| `small_group_min` | 5 | Counts of 1 to 4 are hidden in reports. |
| `health_window_hours` | 26 | A run is overdue if none succeeded within this time. |

These are engineering defaults for the selected directions. Legal review changes them in one place.

## Behaviour

1. **Maximum retention.** A trigger on `form_versions` refuses a new or changed `pending_retention_days` above the maximum. Existing published versions are untouched. `src/lib/connect-intake.ts` validates the same maximum, so the API answers 400 instead of failing in the database.
2. **The sweep, `connect_retention_sweep(p_limit)`** (all ministries, any mode, bounded batch, `SKIP LOCKED`):
   - erases expired pending or associated responses into tombstones (the existing scrub);
   - deletes tombstones whose `erased_at` is older than the tombstone period, together with their redacted consent rows.
   It returns counts only and records them in the run log. It never reads or returns an address, name or response id.
3. **Failure alerting.**
   - `connect_retention_runs` holds counts and status, no ministry and no response id.
   - A failed sweep rolls back, so the script records the failure outside that transaction with `connect_retention_record_failure(code)`.
   - `connect_retention_health()` returns the last success time, the last status and whether a run is overdue or failed since the last success.
   - `npm run connect:retention` runs the sweep and loops until a batch finds nothing. `npm run connect:retention -- check` prints the health and exits non-zero when overdue or failed, for a monitor to alert on.
4. **Small groups.** `connect_suppress_small(n)` and `suppressSmall(n)` return nothing for 1 to 4 and the number otherwise. No aggregate report over tombstones exists yet, so there is no consumer today; HC-15 must use it.

## The one guard that changes

Both `guard_campaign_response()` and `guard_campaign_response_consent()` start with an unconditional refusal of DELETE. Each becomes: refuse, unless all of the following hold.
- Response: the row is already an erased tombstone older than the tombstone period.
- Consent: the row is redacted and its response is such a tombstone.
- The caller is an owner of the erasure definers (`connect_erasure_writer()`).
- The transaction-local setting `app.connect_retention` is `on`, which only the sweep sets and clears.

Everything else about those guards is unchanged. Row-level security adds an owner-only SELECT policy so the sweep can find expired rows across ministries; per-row work then runs under each ministry's existing tenant policies, as in `purge_connect_intake`.

## Not in this PR

Scheduling the sweep and the monitor (an activation step), approving any number, caps for verified records, purge of other Connect tables' own expiry (already handled by `purge_connect_intake`), aggregate reports, a dedicated worker database role (the sweep only deletes expired data and returns counts, so the exposure the C15b review raised does not apply), and the form-settings input limit in the UI.

## Testing

**Database (two ministries):**
- the maximum is enforced on insert and update, shorter is allowed, legacy values are untouched;
- the sweep erases an expired pending response and an expired associated one, in both ministries, and leaves unexpired ones;
- a fresh tombstone survives; a 91-day-old one is deleted with its consent rows, and nothing orphaned remains;
- staff and the application role still cannot delete a response or a consent row, and a delete without the setting is refused;
- the run log records counts and no identifiers; a recorded failure and the health states (never run, ok, overdue, failed since success);
- two sweeps at once never touch the same row;
- the restricted-owner suite as `tester` for the new and changed functions, plus the existing HC-02 to HC-07 suites.

**Unit:** the constants against the SQL policy, `suppressSmall`.
