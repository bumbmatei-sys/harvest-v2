# HC-13 server side: follow-up cases and counselor assignment

Status: engineering plan, written before code. Server only (database, services, API, tests). No screens and no new user-facing copy: error responses reuse existing catalogue messages and carry a machine `details.reason`. Nothing here sends a message or enables collection. Production stays hard-disabled by the unchanged HC-05/HC-07 gates, and every HC-02 activation decision stays UNAPPROVED (`docs/decisions/hc-02-activation-gates.md`).

Sources: Connect PRD sections 2, 3 (J8), 7.1 and 7.2, section 10 (`GET/PATCH .../followup-cases/{caseId}`), 16; ADR 0011 (association model, contract item 4); threat model rows "counselor over-access" and J8; `docs/plans/hc-06.md` ("HC-13 boundary": one case per tenant/response key); HC-DEC2 and HC-DEC3 acceptance. HC-14 (withdrawal propagation, DSAR) and HC-18 (church referral) are out of scope.

## Scope

In: case creation from a verified associated contact, guarded lifecycle, counselor assignment (assign, reassign, unassign), scope-limited reads, audit of every change, erasure/merge/revocation behaviour, bounded paged API.
Out: any UI, notifications, SLA/reminders, language/timezone/workload matching, attempt channel/disposition capture, counseling notes, safeguarding escalation, church referral, aggregates (HC-15), withdrawal propagation (HC-14).

## Data model (migration 0048, table `followup_cases`)

One row per `(tenant_id, response_id)` (the unique "request key" from HC-06): `id` (random, unrelated to the response id), `campaign_id`, `response_id`, `contact_id`, `state`, `assignee_id`, `version`, `created_at`, `updated_at`, `state_changed_at`, `assigned_at`. No name, contact method, free text, notes or consent detail. Composite FKs to the tenant's campaign, response, contact and (for the assignee) workspace membership. `campaign_id` and `response_id` are not readable by the application role.

## State machine

States: `requested`, `awaiting_assignment`, `assigned`, `attempted`, `no_response`, `connected`, `closed`, `withdrawn` (PRD J8/7.1 list; see decisions for what was left out).

| From | To (legal) |
| --- | --- |
| requested | awaiting_assignment, withdrawn |
| awaiting_assignment | assigned, withdrawn |
| assigned | assigned (reassign), awaiting_assignment (unassign), attempted, withdrawn |
| attempted | assigned (reassign), awaiting_assignment, connected, no_response, withdrawn |
| no_response | assigned, awaiting_assignment, attempted (retry), closed, withdrawn |
| connected | closed, withdrawn |
| closed, withdrawn | none (terminal; no reopen, no re-creation: the request key stays used) |

Invariants (CHECK): `assigned`/`attempted` have an assignee; `requested`/`awaiting_assignment`/`withdrawn` have none. Enforced in the database by a guard trigger (transition table, identity immutability, version +1, server-stamped timestamps, assignee must be a member with role owner/admin/member of the same ministry, creation only from an associated response with a live contact and effective follow-up consent) and again in the definer functions, which add the actor rules below.

## Permission matrix

New keys in `src/lib/permissions.ts`: `followup:manage` (owner/admin) and `followup:work` (owner/admin/member). Unknown roles are denied by the existing fall-through.

| Actor | Open cases | List/read | Assign/unassign | Transition |
| --- | --- | --- | --- | --- |
| owner, admin | yes | all cases | yes | any legal, including withdrawn |
| member assigned to the case | no | own open cases only | no | assigned->attempted, attempted->connected, attempted->no_response, no_response->attempted, connected->closed |
| member not assigned | no | none | no | none |
| viewer, non-member, other tenant | no | none | no | none |
| anonymous | 401 | | | |

Every denial (non-member, viewer, unassigned member, other tenant, unknown id for a counselor) returns the same 403 body. Lists return no totals; owner/admin get 404 for an unknown id, a counselor gets 403 for it, so there is no existence oracle.

## Audit events (`audit_logs`, ids and states only)

`followup.case.open`, `followup.case.assign` (from, to, assignee, previousAssignee), `followup.case.unassign`, `followup.case.transition` (from, to), `followup.case.revoke` (system unassignment when an assignee is demoted or removed). Target is the case id. No response, contact, campaign or free text is ever audited. Reads are not audited (see decisions).

## RLS plan

`followup_cases`: ENABLE + FORCE RLS. App role: SELECT policy on tenant (from the verified transaction context) plus live membership, and either owner/admin or (role `member`, assignee = actor, state not terminal). Column-level SELECT grant of the minimal columns only. No INSERT/UPDATE/DELETE grant or policy for the app role: every write is a SECURITY DEFINER function (`SET search_path = pg_catalog, pg_temp`, revoked from PUBLIC, granted to the app role). The migration owner gets a tenant-scoped owner policy so the definers work in restricted-owner mode. Access ends immediately on reassignment, demotion or removal because the policy reads live membership and assignment.

## Lifecycle hooks on existing tables

- Response scrub (contact erasure, response erasure, rights, retention expiry): a BEFORE UPDATE trigger on `campaign_responses` deletes the response's case (nothing identifying survives; the id is random and unlinked).
- Contact merge: an AFTER UPDATE trigger moves the case to the kept contact with the response.
- Demotion to viewer or removal of a member: a BEFORE trigger on `workspace_members` returns that member's `assigned`/`attempted` cases to `awaiting_assignment` and clears the assignee elsewhere (audited as `followup.case.revoke`).

## Test plan

Database level (as the application role): direct-read denial matrix, column grants, no direct writes, definer privileges and `search_path`, guard rejections (illegal transitions, forged identity, non-member/viewer assignee, ineligible creation), RLS policy shape. API level: route handlers with the denial matrix including 401. State machine: every legal and a sample of illegal transitions per state. Assignment: validity, reassign, unassign, revocation by demotion. Audit contents without PII. Erasure (`erase_contact`, response erase, expiry), merge. Paging: default 50, max 200, stable keyset including tied timestamps. Restricted-owner mode (`migrationOwner: true`). Regression: the existing HC-02/05/06/07/DEC2, erasure and CRM suites.

## Decisions I could not settle from the docs (all UNAPPROVED; the stated default is the most restrictive safe choice)

1. **Who is a counselor.** The PRD says "screened counselor"; no screening or counselor role exists. Default: any active member with role owner/admin/member can be assigned; viewers cannot. Founder: a dedicated counselor role or screening attestation?
2. **When a case is opened.** The PRD says a request creates a case; HC-06's claim transaction was deliberately left case-free. Default: owner/admin materialise cases from verified associated responses with effective follow-up consent, idempotently. Founder: open automatically at claim time instead?
3. **Contact details vs the case boundary.** Ordinary CRM permissions let every ministry role (including viewers) read every contact, so the case limits what a counselor sees about the *case*, not about the *person*. Meeting the PRD's "minimal details for their assignment only" needs a restricted-contact visibility decision in the CRM. Not done here.
4. **What a counselor sees.** Default: case id, state, contact reference, timestamps. No campaign, consent scope, language or availability.
5. **After a case is closed or withdrawn.** Default: the counselor's access ends (open cases only); withdrawn also clears the assignee.
6. **State list.** Left out: `referred` (HC-18), `completed` and `unable_to_contact` (PRD "may include"; `no_response` covers it for now), `reassigned` (an event, not a state). Closed/withdrawn are terminal with no reopening.
7. **Case lifetime.** Default: a case is deleted whenever its source response is scrubbed, including the response's retention expiry (30 day engineering default, itself unapproved). An open case can therefore disappear when its response expires. A separate case retention period, or tombstones for aggregates, needs a privacy decision (HC-DEC3/HC-DEC4, HC-15 small-group rules).
8. **Withdrawal.** Automatic propagation of a consent withdrawal into cases is HC-14. Default here: staff set `withdrawn`; opening, assigning, reassigning and moving to `attempted` are refused while the response grant or the CRM ledger shows follow-up as withdrawn.
9. **Case work records.** No link to CRM tasks/notes: those are readable by every role, so linking them would expose case-linked work outside the assignment, and counseling notes need an elevated policy (ADR 0011 item 5). Case work is the state history plus audit only.
10. **Read auditing.** The threat model mentions audited views; only changes are audited. Decide whether case reads need audit rows.
11. **Counselor powers.** Default: a counselor cannot release a case, withdraw it or reassign it; owners/admins can also assign to themselves.
12. **Not designed:** SLA and reminders, workload/language matching, attempt channel and disposition, safeguarding escalation, per-campaign coordinator roles.
