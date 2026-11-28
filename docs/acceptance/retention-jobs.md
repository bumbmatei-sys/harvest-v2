# Retention jobs: audit retention classes

Runner: `retention_rule_batch('audit_logs')` in `drizzle/0200_retention_jobs.sql` (renumbered at merge). Operations: `docs/runbooks/retention-jobs.md`. `RETENTION_JOBS_ENABLED` stays off; nothing here schedules or activates a sweep.

## Founder decision 28 Nov 2026

Gift, payment and consent audit records are kept **10 years**. Every other audit row is deleted after **12 months**. The rule covers both `audit_logs` and `platform_staff_audit`.

The 10-year class is an explicit allow-list of `action` values, derived from the actions the code writes today (`src/` and `drizzle/`). An action not on the list falls into the 12-month class, so a new gift, payment or consent action must be added to the SQL array and to this list.

### Exact actions

| Action | Record |
| --- | --- |
| `contact.consent_record` | CRM consent grant or withdrawal |
| `association.record` | Verified Connect claim linked to a CRM person |
| `followup.case.withdraw` | Follow-up consent withdrawal applied to a case |
| `newsletter.signup.confirmed` | Double opt-in confirmation |
| `newsletter.subscription.set` | List subscribe or unsubscribe, with its consent reference |
| `newsletter.subscriber.create` | Subscriber source |
| `newsletter.subscriber.update` | Suppression change |
| `newsletter.withdrawal.propagated` | Newsletter withdrawal applied to CRM consent |
| `community.email_unsubscribe` | Community email withdrawal |
| `community.email_prefs` | Community email preferences |

### Prefixes

| Prefix | Records |
| --- | --- |
| `giving.` | Gift confirmations and corrections, pledges, ways to give, donor list reads, giving standing and giving reports (staff audit) |
| `fundraising.` | Fundraising campaigns and give pages |
| `ministry.payments.` | Ministry payment account connect, sync, disconnect and pricing |
| `connect.response.` | Connect consent withdrawal, erasure and purge |
| `newsletter.unsubscribe.` | One-click unsubscribe (all lists or one list) |

### For founder review

- Not in the class: `followup.case.revoke` (a case reassigned after a member lost access, not a consent event), `connect.pending.read` (an access log), Connect link, form and landing publication, and in-app community notification preferences.
- No code writes `privacy.*` or `consent.*` actions today, so no such prefix is listed.

## Evidence

`tests/integration/retention-jobs.test.ts` seeds rows 11 months, 13 months and 11 years old for a gift, a payment, a consent action, an ordinary action and a near-miss action, in both tables, and checks that only the 13-month and 11-year ordinary rows and the 11-year class rows are deleted.
