# HC-DEC1: separate, independently withdrawable consent purposes (engineering audit and hardening)

Branch `hc-dec1-consent-purposes`, from `main` at `416e95e`. Server, database-contract and test work only: **no screen, component or copy changed**. Direction: Option A of [the decision sheet](../decisions/hc-02-decision-sheet.md), keep the three separate unchecked purposes (`account_communications`, `outreach_follow_up`, `newsletter`); referrals and events are added **later** as separate opt-ins and are **not** added here.

**HC-DEC1 and every HC-02 activation decision remain UNAPPROVED.** This record approves no purpose, notice wording, lawful basis, country or minor policy. Production collection, real invitation delivery and community email delivery stay hard-disabled.

## 1. Purpose matrix

Two ledgers exist and are deliberately kept apart:

- **Response ledger** (`campaign_response_consents`): what a guest chose on a Connect form, scoped to one response. Append-only, FORCE RLS, no application grants; written only by definer functions.
- **CRM ledger** (`contact_consents`): per person, per channel, append-only. Written by staff (`recordConsent`) or by Connect association/withdrawal projection (`notice_version = 'connect-immutable'`, with a private origin row).

Effective state is always derived from the ledger, never stored. Rule (identical in the record page, list badge, filters, export, association gate): a withdrawal stays outstanding until a later grant that is later on **both** clocks (`recorded_at` and `occurred_at`); redacted evidence never counts.

| Purpose | Recorded where | Default | Checked where (before any send, contact or processing) | Withdrawal |
| --- | --- | --- | --- | --- |
| `account_communications` | Response ledger only, on Connect form versions of kind v2/v3 (never v1). **Not** projected to the CRM ledger (the association copies only `newsletter` and `outreach_follow_up`; a trigger rejects any other Connect-provenance purpose). Staff can still record it in the CRM ledger as an ordinary event. | Not granted. Granted only if the published version offers it **and** the guest selects it. | `connect_invitation_eligible` on enqueue, pending read, prepare, flow, consume and **again at dispatch (`check`) immediately before the provider call**. Fixed-text invitation only (`Invitations.emailBody`); no caller-supplied body. | Guest (receipt), signed-in subject, or owner/admin inserts a `withdrawn` row; trigger `connect_invitation_cancel` deletes every invitation, token and flow in the same transaction. Immediate. |
| `outreach_follow_up` | Response ledger; copied to the CRM ledger on verified association (grant skipped if a withdrawal exists for that response); later withdrawal is projected by trigger `connect_project_withdrawal`. | Not granted (same rule). | Shared CRM filters `followup_email` / `followup_sms` and the list/count/export predicates (per channel). No association purpose maps to it and **no code path sends follow-up today**; the Zernio Auto-DM/automation sender does not exist yet. | Response ledger row + CRM projection in the same transaction; filters and exports reflect it on the next read. |
| `newsletter` | As above. Also a CRM association purpose. | Not granted. | Association gate `recordAssociation` (`purposeConsent`, plus the database insert guard on `crm_associations`); filter `newsletter` and list/count/export predicates. **No newsletter sender exists.** | As above. |
| `marketing` | CRM ledger only, staff-recorded. | Not granted. | Filter `marketing`, list badge and the export column. No sender. | Staff-recorded `withdrawn` event; effective immediately. |
| `messaging`, `form_follow_up` | CRM ledger only, staff-recorded. | Not granted. | `recordAssociation` gate (the only two other association purposes). A `messaging` grant never covers `form_follow_up` and vice versa. | Staff-recorded `withdrawn` event; the gate and the database guard refuse new associations at once. |
| `event_administration` | CRM ledger only, staff-recorded. | Not granted. | No consumer in code. | Staff-recorded `withdrawn` event. |
| `legacy_unspecified` | Rows migrated from before purposes existed; cannot be written by the API (not in the staff purpose list). | Never granted anything. | Every check matches an exact purpose, so a legacy row never satisfies a gate, filter or export. Fails closed. | n/a |

Surfaces that were audited for a contact or send path, and what each does:

| Surface | Result |
| --- | --- |
| Community notification email worker (`community_email_enqueue/claim/complete`, `scripts/send-community-email.ts`) | Not a consent-ledger flow: it is a member's own notification preference (`off`, `important` default, `daily`, `weekly`). Content is fixed system templates built from the member's own notification rows (names and titles only, sanitized). Instant mail is limited to events about the person's own request or moderation; replies, likes and host alerts go only in opt-in digests. `off`, mute, read rights and "already read" are **re-checked at claim time**, not only at enqueue. It reads no CRM ledger row, so it cannot be used to deliver newsletter or follow-up content. Live sending is hard-disabled. See finding F5. |
| Connect invitation email | Fixed transactional text; gated by `account_communications` at dispatch; hard-disabled live. |
| Sign-in code email | Authentication only; unrelated to purposes. |
| CRM events and outbox/webhooks | Payloads carry ids, categories and field names only; they never carry a message to a person and a webhook endpoint is the ministry's own system. There is no automation that contacts a person from an event. `crm.person.consent_recorded` and `crm.association.recorded` carry the purpose, validated against the registry (finding F3). |
| AI assistant tools (`src/server/ai/crm-tools.ts`) | Read tools return per-purpose effective state, never evidence or activity content. Write tools are `crm_create_task` and `crm_move_deal` only, approval-gated, and cannot record consent, record an association or send anything. |
| CSV export | Uses the same list predicates as the screen, so a newsletter-withdrawn person is excluded from a newsletter-granted segment. It exports no consent evidence. |
| CSV import and merge | Import never writes the consent ledger (a re-import cannot grant). Merge moves consent events with their original timestamps, so an older grant cannot beat a newer withdrawal. |
| Shared CRM filters | `permissionScopes` maps each filter to exactly one purpose/channel scope of the same ledger rule. |


## 2. Invariants verified (code and tests)

| Invariant | Where enforced | Evidence |
| --- | --- | --- |
| a. No purpose is granted unless offered **and** selected; omitted or unoffered purposes never grant; one purpose never implies another | Zod (`intakeSubmission`, min 1, subset of the registry); `submit_connect_intake` (`p_purposes <@ offered`, distinct, channel matches choice); `guard_campaign_response_consent` (`purpose was not offered`); association copies only selected, unwithdrawn `newsletter`/`outreach_follow_up` | `hc-dec1-consent-invariants`: each single purpose selected from an offer of all three grants exactly that row and queues an invitation only for `account_communications`; unoffered and extra purposes refused with nothing written; CRM follow-up never opens the newsletter gate and the reverse. Existing: `hc05-intake`, `hc06b-foundation` (account-only claim writes no CRM consent), `crm-associations` |
| b. Independent withdrawal; latest state wins; replay, redelivery, import, merge cannot re-grant | Append-only ledgers; both-clocks rule; `guard_campaign_response_consent` (`purpose was withdrawn`); import code never touches the ledger; merge keeps original timestamps | `hc-dec1-consent-invariants`: withdrawing newsletter leaves the others and the invitation; replay of the same submission writes nothing; a direct database insert of a new grant is refused; withdrawing twice is idempotent; withdrawing account communications removes only the invitation; a late-recorded backdated grant does not clear a withdrawal on list, export, gate, permission card or record; imports (skip and fill, existing and new people) write no consent row and leave an opt-out; merge with an older grant and a newer withdrawal keeps the withdrawal |
| c. Send-time checks, fail closed on missing, withdrawn and `legacy_unspecified` | Invitation: `connect_invitation_eligible` at every step including dispatch. Association gate: `purposeConsent` plus database insert guard. Community email: preference and eligibility re-checked at claim | Existing: `hc07-invitations` (withdraw/erase cancel delivery, token, flow and grant), `crm-associations`, `community-email-db` (claim-time re-checks). New: a legacy row satisfies no gate, filter or export; community email functions read no consent ledger; the assistant has no consent, association or messaging tool |
| d. Cross-surface consistency | One rule in `consentState` (filters, list, count, export) and `purposeConsent` (gate, permission card) | New agreement test over six ledger shapes (none, granted, withdrawn, re-granted, unknown-after-grant, legacy): list, export, count, association gate and permission card agree for every shape; withdrawn people are found only by the withdrawn filter |
| e. Extensibility without weakening | `src/lib/consent-purposes.ts` | Unit test (lists derive from the registry; schema source constraints equal the registry; no referrals/events entry) and integration drift test (live check constraints and Connect functions equal the registry). Both fail when the registry is changed without the matching schema and migration, shown below |

## 3. Findings

**Fixed**

- **F1. Purpose lists were copied** in `connect-data` (`connectPurposes`), `connect-intake` (`intakePurposes`, plus a hard-coded `.max(3)`), `contact-input` (`consentPurposes`) and `schema.ts` (`associationPurposes`). They now derive from one registry (`src/lib/consent-purposes.ts`). Behaviour is unchanged; `drizzle-kit generate` reports no schema change.
- **F2. Nothing detected drift** between the TypeScript lists, the schema checks and the live database. Added the unit source guard and the integration guard. Mutation check: flipping one registry flag fails 3 unit tests (association list, derived lists, order helper) and 2 integration tests; flipping `marketing` to Connect-offered fails the constraint and Connect-function guards.
- **F3. `crm.association.recorded` accepted any string as `purpose`** (the other events already use an enum). It is now validated against the association purposes. Failing-then-passing: the new unit assertion `anything_else` is rejected fails on the original contract and passes after. Existing outbox rows are unaffected (the association input already enforced the three values).

**No gap found** (verified, no change)

- Defaults, offered-and-selected rule, independent withdrawal, replay and re-grant protection, send-time re-checks and fail-closed legacy handling already held in the database and services. The new tests lock them in.

**Found, not changed (needs a decision or a later feature)**

- **F4. Channel semantics differ by design.** The newsletter list, count and export use the **email** channel only; the association gate (`purposeConsent`) counts a grant on **any** channel for the purpose, and a withdrawal on **any** channel blocks it (fail closed). A newsletter grant recorded on SMS or social therefore does not put a person in the email segment but does satisfy the gate. No send exists, so nothing is contacted. Pinned by a test so a change is deliberate. **Founder/product decision:** should a newsletter permission on a non-email channel count at all?
- **F5. Community notification email is outside the consent ledger.** `important` (application decisions, warnings, held-post and appeal decisions about the person's own request) is **on by default** (founder decision 13 Nov, C15b); replies, likes and host alerts are opt-in digests. It is member-controlled and limited to fixed system text, with one-click unsubscribe, but whether it is covered by `account_communications` or needs its own lawful basis is a **legal/product decision**. It must never be extended with staff-authored content without a purpose check.
- **F6. No sender exists** for `outreach_follow_up`, `newsletter` or `marketing`, and there is no shared "may contact this person for this purpose and channel" function. When the first sender is built (Zernio Auto-DMs, a newsletter send) it must call the ledger rule at send time, not only at enqueue. Not built here: there is no consumer, and adding one would be scope expansion.
- **F7. `account_communications` is response-scoped by design** (not copied to the CRM ledger), so CRM filters and exports cannot segment by it. Staff-recorded `account_communications` events exist but gate nothing.
- **F8. Connect SQL spells the purpose lists** (offer caps 2 and 3, `IN (...)` lists in the 0028/0029/0032 functions). Adding referrals or events needs one registry entry plus one migration that widens the check constraints and those functions; the drift guard fails until it does.
- **F9. Staff can attest a grant.** `recordConsent` lets a member with write access record any staff-recordable purpose with a free-text source and evidence (audited, append-only, not tied to a form offer). That is the CRM-02 design, not an inference, but it is the one place a grant is not "selected by the person" on a form; whether staff attestation should be limited for newsletter and follow-up is a **policy decision**.
- `purposeConsent` does not skip redacted later grants as `consentState` does; redaction happens only on erasure and erased people are excluded from the gate, so there is no reachable effect.

## 4. Migration

**None.** The audit found no database gap: the check constraints and Connect functions already enforce the rules, and the new drift test now proves they match the registry.

## 5. Tests

- `tests/unit/consent-purposes.test.ts` (13): registry shape, derivation, legacy and projection rules, schema source guard, validation of omitted/unknown/unoffered purposes, event contract.
- `tests/integration/consent-purposes-drift.test.ts` (3): live check constraints and Connect functions against the registry.
- `tests/integration/hc-dec1-consent-invariants.test.ts` (13): Connect defaults and independent withdrawal, CRM never-implied, backdated and replayed grants, six-shape agreement across list, count, export, gate and card, merge, import, legacy, channel difference, assistant tools, community email independence.
- Run results are listed in the pull request.

## 6. Not done

- Referrals and events purposes (later, separate opt-ins; one registry entry plus one migration each).
- Any sender, any shared send-time helper, any change to community email, any screen, copy or notice wording.
- Real collection, real invitation delivery, community email delivery and deployment remain **hard-disabled**. No production migration was added or applied.
- **HC-DEC1 and all five HC-02 activation decisions remain UNAPPROVED.** Privacy/legal review of lawful basis and notice wording per purpose, launch countries and minors are still required.

## 7. Founder decisions this surfaced

1. F4: do non-email newsletter permissions count? 2. F5: legal classification of default-on community decision emails. 3. F9: may any staff member attest newsletter or follow-up consent, or only owners/admins with evidence? 4. Before the first sender (F6): who owns the send-time check.
