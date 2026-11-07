# HC-02 activation decisions

Reconciled 2026-11-07. **All five decisions remain UNAPPROVED.** This register makes the existing HC-02 §5 gates actionable; it chooses no policy, retention duration or legal basis. Sources: [HC-02 acceptance §5](../acceptance/hc-02.md#5-decisions-for-matei-encoded-as-the-most-restrictive-default-confirm-before-hc-05-collects-real-data), [Connect PRD](../prd/harvest-connect-qr-to-discipleship.md), [threat model](../security/harvest-connect-threat-model.md).

| Gate | Current implementation | Decision and evidence required before activation | Owner |
| --- | --- | --- | --- |
| Purpose mapping | Separate `account_communications`, `outreach_follow_up`, `newsletter`; referral and religious classification excluded | Confirm offered purposes and reviewed notices/lawful basis for each; keep opt-ins separate and unchecked | Matei with qualified privacy/legal review |
| Pending metadata access | Owner/admin-only metadata; application cannot read names/contact methods | Confirm access matrix, staff rights-request procedure and verification; test all permitted and denied roles | Matei with security/privacy review |
| Erasure tombstones | Re-keyed, day-level campaign/link/form and redacted evidence | Assess small-cohort linkability and retained fields; approve retention or specify full deletion; test resulting erasure behavior | Matei with privacy/legal review |
| Retention | Explicit per-form durations, no approved policy maximum or durations | Approve launch-specific durations and maximum, then implement bounds and scheduled purge with failure evidence before real collection | Matei with privacy/legal review; implementation owner after decision |
| Contact-method protection | Plaintext staging values with zero application grants and DB encryption at rest | Decide application encryption/key management and access threat model; implement and verify approved protection before real addresses are stored | Matei with security review; implementation owner after decision |

HC-03 resolves public resource links without collecting guest responses. These gates do not prevent technical review of that bounded slice, but merging its code cannot approve real collection, invitations, deliveries or deployment. HC-05/HC-07 must read this register and obtain the actual decisions before enabling real data. No fabricated approval date or reviewer is recorded here.

When a decision is made, record its date, approver, scope/jurisdiction, approved policy and supporting evidence here and reconcile HC-02 §5 and Craft. Keep any unresolved gate explicitly unapproved.
