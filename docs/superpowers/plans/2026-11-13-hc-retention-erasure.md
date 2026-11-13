# Connect retention and erasure jobs: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** enforce the 30-day maximum, sweep expired responses and old tombstones across ministries, record runs and expose health for alerting, and provide the small-group helper. Database and server only.

**Spec:** `docs/superpowers/specs/2026-11-13-hc-retention-erasure-design.md`

## Global Constraints

- **Branch and migration:** branch `hc-retention`; migration `0043_connect_retention`.
- **No UI changes.** All five HC-02 gates stay UNAPPROVED; real collection stays hard-disabled.
- **Guards:** only the DELETE branch of the two guard functions changes, and only for the case in the spec.
- **Privacy:** the run log and the sweep result hold counts only.
- **Database pattern:** definers with owner policies keyed on settings only they set and clear; restricted-owner tests as `tester`.

## Tasks

### Task 1: Pure pieces

**Files:** `src/lib/connect-retention.ts`, `src/lib/connect-intake.ts`, `tests/unit/connect-retention.test.ts`.

- [ ] Constants, `suppressSmall`, and the intake schema using the maximum. Unit tests.

### Task 2: Migration 0043 and database tests

**Files:** `src/db/schema.ts`, `drizzle/0043_connect_retention.sql` (+ snapshot, journal), `tests/integration/hc-retention-db.test.ts`, `tests/integration/hc02-definer-owner.test.ts` and `tests/integration/hc02-connect.test.ts` (fixtures kept within the maximum).

- [ ] Schema: `connectRetentionRuns`; generate.
- [ ] Hand-written SQL: policy function, small-group function, retention trigger, run log with owner policy, scan policy, both guards, `connect_retention_sweep`, `connect_retention_record_failure`, `connect_retention_health`, grants.
- [ ] Database tests from the spec. Run the existing Connect suites and the restricted-owner suites. Commit.

### Task 3: Script and server

**Files:** `src/server/connect-retention.ts`, `scripts/connect-retention.ts`, `package.json`, `tests/integration/connect-retention.test.ts`.

- [ ] Tests: the run loop, `check` exit status for each health state, and failure recording outside the failed transaction.
- [ ] Implement. Typecheck and lint. Commit.

### Task 4: Records, PR, CI, review

- [ ] `docs/acceptance/hc-retention.md`, the activation-gates register (implementation exists, gates unapproved), `docs/setup/feature-flags.md` or the Connect setup doc for scheduling, `CLAUDE.md` (0043 used, 0044 next).
- [ ] Full suites plus the `tester` suites. Draft PR. CI, Neon from `main`, independent review. Do not merge without approval.
