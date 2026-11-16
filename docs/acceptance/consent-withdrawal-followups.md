# Consent withdrawal follow-ups (migration 0050)

Branch `consent-withdrawal-followups`, from `main` at `e50d035` (HC-13, #82, on top of HC-DEC1b, #81). Server, database, tests and docs only: **no screen, component or user-facing copy changed** (the founder is replacing the UI kit). It follows up findings from the independent reviews of HC-DEC1b and HC-13.

**Everything here is an engineering default, UNAPPROVED pending legal review.** No HC-02 activation decision is approved, no sender is built, and production collection, real invitation delivery and deployment stay hard-disabled. Migration 0050 is not applied anywhere beyond local test databases.

## What changed

1. **Consent permissions are split** (`src/lib/permissions.ts`, `recordConsent` in `src/server/contacts.ts`).
   - New `contacts:record_withdrawal`: owner, admin and member. Recording a **withdrawal** on a person's behalf needs it, so a member who receives an opt-out can record it instead of waiting for an owner or admin.
   - `contacts:attest_consent` stays owner/admin and now gates **grants and `unknown`** only.
   - The permission is chosen from the validated status after the existing input validation, so validation order and denial semantics are unchanged: viewers, non-members and unknown roles (`pastor`, `volunteer`, empty) are denied for every status; members and viewers get the same role denial; a non-member gets the existing workspace denial; a denial reveals nothing about whether a person exists (a member's grant attempt on an unknown person id gets the same 403).
   - A member's withdrawal still needs a method (`source`), evidence text and a sane date (not in the future, not before 1990), still writes the ids-and-categories-only audit row (attributed to the member), and a withdrawal can never be undone by an older grant (the ledger rule is unchanged). The database policy is tenant-scoped, not role-scoped, so no SQL change was needed for this item.
2. **HC-13 follows the `mayContact` rule** (migration `0050_followup_consent_any_channel`). `followup_consent_effective` (used by the case insert guard, `open_eligible_followup_cases`, `assign_followup_case` and the move to `attempted`) read the CRM ledger per **same** channel. It now agrees with `mayContact` for the follow-up purpose: a withdrawal on **any** channel (outstanding until a later grant on the same channel, later on both clocks) blocks opening, assigning and attempting; a grant must still be the latest event on the response's own channel. Only the `AND w.channel = g.channel` predicate in the withdrawal lookup was removed; the rest of the 0048 body is identical apart from `CREATE OR REPLACE` (diffed). `CREATE OR REPLACE`, invoker rights, `search_path = pg_catalog, pg_temp`, owner and the `REVOKE` from PUBLIC unchanged and repeated, so the migration is re-runnable. FORCE RLS, tables, triggers and grants untouched; journal entry (`idx` 50, `when` 1795200000000) and a snapshot chained from the 0048 snapshot (schema unchanged, only `id` and `prevId` differ).
3. **Docs.** `docs/decisions/hc-02-activation-gates.md` gains "Activation prerequisites outside the five decisions"; the stale F4 sentence in `hc-dec1.md` is corrected; the `consent-gate.ts` header now claims SQL/TypeScript agreement only for the newsletter and says the gate is stricter for other purposes (the safe direction); `hc-dec1b.md` and `hc-13.md` are updated.

## Tests (synthetic data, embedded PostgreSQL as the restricted `tester` user)

- `tests/unit/permissions.test.ts`: the split (`record_withdrawal` true for owner/admin/member only; `attest_consent` owner/admin only; unknown roles denied).
- `tests/integration/consent-gate.test.ts`: member withdraws across seven purpose/channel pairs and it takes effect in `mayContact`, the association gate, and the list, count and export filters; evidence rules and audit rows for a member's withdrawal; a member's grant is 403; viewer, non-member denied for everything; owner/admin both; the same 403 for an unknown person id.
- `tests/integration/hc13-follow-up-cases.test.ts` ("follow-up consent agrees with mayContact"): email grant with an SMS or social withdrawal blocks open, direct insert, assign and attempt; withdrawal lifted only by a later same-channel grant; an SMS-only grant never allows an email response; a newsletter withdrawal does not block follow-up; `followup_consent_effective` equals `mayContact` on nine ledger shapes.
- `tests/integration/hc13-owner.test.ts`: the same block-by-another-channel path with a real non-superuser, non-BYPASSRLS migration owner and a member recording the withdrawals.
- Updated assertions: only the #81 test that asserted a member is denied a **withdrawal** (the decided gap); it now asserts the split. No HC-13 assertion encoded the same-channel behaviour, so none changed. No assertion was weakened.
- Failing-then-passing: with the 0050 predicate restored to same-channel, three new HC-13 tests fail; with `recordConsent` pinned to `contacts:attest_consent`, the new member-withdrawal test and the restricted-owner test fail. Both pass with the change.

## Not done

- **Audit actor for system revocations.** The reviewer nit asked `followup_member_revoked` to record a fixed "system" actor instead of the removed user's id when `app.user_id` is unset. `audit_logs.actor_id` is `NOT NULL` with a foreign key to `users.id`, and no definer in the codebase records a system actor, so a literal value would make member removal fail. Left unchanged; needs a decision (a reserved system user row, or a nullable actor column). See the report.
- **UI.** No screen changed. The people page still shows consent controls to members until the UI is rebuilt; grant controls should be gated on `can(role, "contacts:attest_consent")` and withdrawal controls on `can(role, "contacts:record_withdrawal")`. A member's grant attempt still returns 403.
- HC-14 withdrawal propagation into open cases, CRM contact visibility, audit retention, denial logging and the staff rights-request procedure are listed (not built) in the HC-02 gates register.
- All defaults remain **UNAPPROVED**; production stays hard-disabled; no sender exists.
