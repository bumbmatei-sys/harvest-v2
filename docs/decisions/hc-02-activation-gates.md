# HC-02 activation decisions

Reconciled 2026-11-07. **All five decisions remain UNAPPROVED.** This register makes the existing HC-02 §5 gates actionable; it chooses no policy, retention duration or legal basis. Sources: [HC-02 acceptance §5](../acceptance/hc-02.md#5-decisions-for-matei-encoded-as-the-most-restrictive-default-confirm-before-hc-05-collects-real-data), [Connect PRD](../prd/harvest-connect-qr-to-discipleship.md), [threat model](../security/harvest-connect-threat-model.md).

| Gate | Current implementation | Decision and evidence required before activation | Owner |
| --- | --- | --- | --- |
| Purpose mapping | Separate `account_communications`, `outreach_follow_up`, `newsletter`; referral and religious classification excluded | Confirm offered purposes and reviewed notices/lawful basis for each; keep opt-ins separate and unchecked | Matei with qualified privacy/legal review |
| Pending metadata access | Owner/admin-only metadata; application cannot read names/contact methods | Confirm access matrix, staff rights-request procedure and verification; test all permitted and denied roles | Matei with security/privacy review |
| Erasure tombstones | Re-keyed, day-level campaign/link/form and redacted evidence | Assess small-cohort linkability and retained fields; approve retention or specify full deletion; test resulting erasure behavior | Matei with privacy/legal review |
| Retention | Explicit per-form durations, no approved policy maximum or durations | Approve launch-specific durations and maximum, then implement bounds and scheduled purge with failure evidence before real collection | Matei with privacy/legal review; implementation owner after decision |
| Contact-method protection | HC-02 schema restricts staging values with zero application read grants; HC-05 local synthetic intake adds authenticated application ciphertext and opaque canonical method references. No real-data key-management design is approved | Decide application encryption/key management and access threat model; implement and verify approved protection before real addresses are stored | Matei with security review; implementation owner after decision |

## Founder-selected directions (13 Nov 2026) — still UNAPPROVED

On 13 Nov 2026 Matei chose a direction for each gate from the [decision sheet](hc-02-decision-sheet.md). **These are directions for engineering to build toward, not activation approvals.** Every gate stays UNAPPROVED until its review below is done and its date, approver, scope/jurisdiction, approved policy and evidence are recorded in the table above. Real collection, real invitation delivery and deployment stay hard-disabled.

| Gate | Selected direction | Review still required before approval |
| --- | --- | --- |
| Purposes (HC-DEC1) | Option A: keep the three separate unchecked purposes; add referrals and events later as separate opt-ins | Privacy/legal review of lawful basis and notice wording per purpose; launch countries and minors still open |
| Pending metadata access (HC-DEC2) | Option A: owner/admin only until assigned-counselor access exists (HC-13) | Security review of the access matrix and staff rights-request procedure |
| Erasure tombstones (HC-DEC3) | Option B: coarse tombstone for a short fixed period, hide small groups | Privacy/legal review of retained fields, the period and small-group linkability |
| Retention (HC-DEC4) | Option A: 30 days maximum for unverified entries, shorter per form allowed; verified caps set later | Legal review of the durations and verified-record caps; purge monitoring |
| Contact-method protection (HC-DEC5) | Option A: managed key service with rotation, restricted decryption, audit trail | Independent security review of the key design; provider/hosting transfers if relevant |

**Engineering status (13 Nov 2026):** the retention maximum, the cross-ministry sweep, tombstone expiry, run log with health check and the small-group helper are built for the HC-DEC3 and HC-DEC4 directions (`docs/acceptance/hc-retention.md`, migration 0043). Their numbers (30 days, 90 days, fewer than 5) are engineering defaults and are **not approved**; scheduling and alerting are activation steps. The other three directions have no implementation yet.

HC-03 resolves public resource links without collecting guest responses. These gates do not prevent technical review of that bounded slice, but merging its code cannot approve real collection, invitations, deliveries or deployment. HC-05/HC-07 must read this register and obtain the actual decisions before enabling real data. HC-05 synthetic implementation evidence is in [its acceptance record](../acceptance/hc-05.md); it adds no activation approval. No fabricated approval date or reviewer is recorded here.

When a decision is made, record its date, approver, scope/jurisdiction, approved policy and supporting evidence here and reconcile HC-02 §5 and Craft. Keep any unresolved gate explicitly unapproved.

Plain-language options and recommendations for these five decisions: [decision sheet](hc-02-decision-sheet.md) (presents options only; approves nothing).
