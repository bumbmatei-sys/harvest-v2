# HC-DEC1b: newsletter channel scope, staff attestation, one send-time check (engineering defaults)

Branch `hc-dec1b-consent-gate`, from `main` at `3fd2003` (HC-DEC1, #80). Server, database and test work only: **no screen, component or copy changed**. It follows up findings F4, F5, F6 and F9 of [hc-dec1.md](hc-dec1.md).

**The four decisions below are engineering defaults delegated by the founder. They are UNAPPROVED pending legal review and are recorded here as defaults, never as approved.** HC-DEC1b and every HC-02 activation decision remain UNAPPROVED. Production collection, real invitation delivery, community email delivery and deployment stay hard-disabled. No sender for newsletter, follow-up or Auto-DMs is built.

## 1. Decisions (engineering defaults, UNAPPROVED)

| Finding | Default | Where |
| --- | --- | --- |
| Q1 / F4 newsletter channel | A newsletter permission counts toward the association gate only if recorded for the **email** channel (matching the email-only newsletter list and export). A newsletter **withdrawal on any channel still blocks** (strict grant, broad withdrawal). Only the newsletter is email-scoped: `messaging`, `form_follow_up` and the follow-up purposes are unchanged. | `purposeGrantChannels` in `src/lib/consent-purposes.ts`; `decideConsent` in `src/server/consent-gate.ts` (service gate and permission card); `consentState` in `src/server/crm-filters.ts` (list, count, export, saved views); migration 0047 (database insert guard) |
| Q2 / F5 community decision emails | `application`, `warning`, `held_decision` and `appeal_decision` emails are classed as **account-communications-type service messages**: fixed templates only, never carrying marketing, newsletter or outreach content. They are **not** routed through the consent ledger and their behaviour is unchanged (member preference `off`/`important`/`daily`/`weekly`, claim-time re-checks, hard-disabled delivery). **Needs legal review** (lawful basis for default-on service mail). | `tests/unit/consent-gate.test.ts` (template guard) |
| Q3 / F9 staff attestation | Only owners and admins may record or attest consent on a person's behalf (new permission `contacts:attest_consent`). Members and viewers are denied for every status, grants and withdrawals alike. A person's own self-service (Connect receipt, signed-in subject) stays the primary route. Evidence: non-empty method (`source`) and evidence text, and a date that is not in the future (five minutes of clock skew) and not before 1 January 1990; when no date is given, the time of recording is stored. | `src/lib/permissions.ts`, `src/server/contacts.ts` (`recordConsent`), `src/lib/contact-input.ts` |
| Q4 / F6 send-time check | One module owns the question: `mayContact(tx, tenant, person, purpose, channel)` in `src/server/consent-gate.ts`, with a pure `decideConsent` over ledger rows. Reasons: `consent_missing`, `consent_withdrawn`, `purpose_not_contactable` (`legacy_unspecified` or unknown purpose), `channel_not_permitted`, `person_unavailable` (erased, missing or another ministry). Fails closed; reasons carry no personal data. A source guard fails any module that imports a message provider or a known sender entry point without importing the gate and calling `mayContact`. | `src/server/consent-gate.ts`, `scripts/source-guards.ts` |

## 2. What changed

- `src/lib/consent-purposes.ts`: derived lists are `Object.freeze`d and typed as `readonly` tuples (reviewer note 2; no caller broke); `purposeGrantChannels` and `grantCountsOnChannel`.
- `src/server/consent-gate.ts` (new): `decideConsent` (pure), `loadLedger`, `mayContact`. `purposeConsent` in `crm-associations.ts` is now a thin wrapper over it, so the association gate and the permission card share the rule. Same SQL, same ordering; the only behaviour change is Q1.
- `src/server/crm-filters.ts`: `consentState` (list, count, export, saved views, the shared filters) reads the newsletter's withdrawal across all channels and counts only an email grant, exactly as the gate does. Every other purpose and channel is unchanged.
- **Migration 0047** (`0047_consent_gate`): `CREATE OR REPLACE FUNCTION public.guard_crm_association()` adds `AND (c.purpose <> 'newsletter' OR c.channel = 'email')` to the grant lookup, so a direct insert cannot attach an association to a non-email newsletter grant. Re-runnable, keeps the owner, grants and trigger; FORCE RLS untouched; no new function, so no `SECURITY DEFINER` or grant changes are needed. Journal entry and a snapshot chained from 0046 (no schema change: `drizzle-kit generate` reports none). Production migrations are not applied.
- `recordConsent` requires `contacts:attest_consent` and writes an audit row with ids and categories only (`consentId`, `purpose`, `channel`, `status`, `attested: "staff"`); source and evidence text, names, emails and phone numbers never enter it.
- `src/server/crm-events.ts`: `crmEnvelope` no longer drops events silently. It increments `crmEnvelopeDrops` (per process) and logs a fixed code (`crm_envelope_unknown_kind`, `crm_envelope_invalid_payload`), no ids and no payload (reviewer note 3). Callers already fail visibly (job failure, `EVENT_UNAVAILABLE`).
- Reviewer note 1: the two Connect purpose lists changed order in HC-DEC1; nothing depends on it (see hc-dec1.md section 6).

### Matrix (replaces the F4 and F9 rows of hc-dec1.md)

| Ledger shape (newsletter) | list / count / export (granted) | withdrawn filter | association gate | permission card | `mayContact` email |
| --- | --- | --- | --- | --- | --- |
| none | no | no | missing | none | `consent_missing` |
| email grant | yes | no | allowed | granted | allowed |
| SMS grant | no | no | missing | none | `consent_missing` |
| social grant | no | no | missing | none | `consent_missing` |
| email grant, SMS withdrawal | no | yes | withdrawn | withdrawn | `consent_withdrawn` |
| SMS grant, email withdrawal | no | yes | withdrawn | withdrawn | `consent_withdrawn` |
| email grant, withdrawal, re-grant | yes | no | allowed | granted | allowed |

`mayContact(newsletter, sms|social)` is always `channel_not_permitted`.

### Surfaces deliberately not routed through the gate

- **Community email** keeps its member-preference model (Q2), hard-disabled.
- **Connect invitation** keeps its SQL re-check at dispatch (`connect_invitation_eligible`, response ledger); it reads a different ledger, so routing it through the CRM-ledger gate would not be a pure refactor. It is listed as an exemption in the guard.
- Sign-in code email is authentication only.
- CRM webhooks deliver to the ministry's own endpoint, not to a person, and are outside the guard.

## 3. Tests run (local, synthetic)

- `tests/unit/consent-gate.test.ts` (238): decision table over every purpose x channel x nine ledger shapes; newsletter-only scope; frozen lists; attestation permission and evidence validation; the source guard (fails a fake sender that omits the gate, passes one that calls `mayContact`, rejects a mention without a call, no ungated sender in the repository, no stale exemption); community-email template guard (the four instant kinds, template variables limited to `community, summary, count, name, others, url`, no newsletter/marketing text or links in the templates, rendered mail links only to the community's own pages and unsubscribe, member text cannot add links); `crmEnvelope` drop counter.
- `tests/integration/consent-gate.test.ts` (9): list, count, export, association gate, permission card and `mayContact` agree on all seven ledger shapes; the database guard refuses an SMS newsletter grant; messaging, form_follow_up and follow-up purposes unchanged; `mayContact` fail-closed cases; owner and admin allowed, member, viewer and a non-member denied for every status with nothing written; evidence validation; audit row content.
- Updated existing tests, each because the old behaviour was the gap decided above: `contacts.test.ts` (three tests recorded consent as a member: now an owner records, and a member is asserted denied), `crm-associations.test.ts` (a social newsletter grant no longer allows an association; an email grant does), `hc-dec1-consent-invariants.test.ts` (the pinned F4 difference is replaced by the new rule). No assertion was weakened.
- Failing-then-passing: with `contacts.ts`, `permissions.ts` and `contact-input.ts` reverted, 3 of the new integration tests fail (denial, evidence, audit); with `crm-associations.ts` and `crm-filters.ts` reverted, the shape-agreement test fails; with migration 0047 removed, the database guard test fails. All pass with the change.

## 4. Not done / needs a decision

- No sender for newsletter, follow-up or Auto-DM; no change to community email, Connect invitations or any screen.
- The record page still shows the consent form and permission buttons to members; they now receive a 403. Hiding them is a UI change, left for the UI-kit replacement (gate the controls on `can(role, "contacts:attest_consent")`).
- **Decision for the founder:** members can no longer record a **withdrawal** on a person's behalf either (the instruction was owner/admin only). If a member receives an opt-out request they must hand it to an owner or admin; consider allowing members to record withdrawals only.
- The roles `pastor` and `volunteer` do not exist in the permission model (`owner`, `admin`, `member`, `viewer`); they would be denied like any unknown role.
- Legal review of all four defaults, lawful basis per purpose, launch countries and minors. **All five HC-02 activation decisions remain UNAPPROVED.**
