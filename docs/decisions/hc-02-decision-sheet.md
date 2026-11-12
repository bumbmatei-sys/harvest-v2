# HC-02 decision sheet for Matei

Prepared 2026-11-12. **All five decisions remain UNAPPROVED.** This sheet only presents options and recommendations. It records no approval, chooses no policy and gives no legal conclusion. The register of record is [hc-02-activation-gates.md](hc-02-activation-gates.md).

## Summary

| # | Gate | Recommendation | Needs legal review |
| --- | --- | --- | --- |
| 1 | Purposes (HC-DEC1) | Option A: keep three separate purposes; add referrals and events later, each with its own opt-in | Yes |
| 2 | Who sees pending responses (HC-DEC2) | Option A: owner/admin only until assigned-counselor access exists | No (security review: yes) |
| 3 | After erasure (HC-DEC3) | Option B: keep only a coarse tombstone for a short, fixed period, hide small groups | Yes |
| 4 | Retention (HC-DEC4) | Option A: 30 days maximum for unverified entries, shorter allowed; verified caps set later | Yes |
| 5 | Encrypting contact details (HC-DEC5) | Option A: managed key service, rotation, restricted decryption, audit | No (security review: yes) |

Nothing here approves collecting real data, sending real messages or deploying. Real collection stays hard-disabled until each gate is recorded as approved.

## Gate 1. Purposes (HC-DEC1)

**Question.** Which separate reasons may a guest agree to be contacted for?

**Options**
- **A. Three purposes plus later additions.** Keep account messages, pastoral follow-up and newsletter as separate, unchecked, independently withdrawable choices. Add referrals and events later, each its own choice. Safest; more checkboxes.
- **B. Three purposes only, permanently.** No referrals or events. Simplest; blocks church referral (HC-18) and event invitations.
- **C. Fewer, broader purposes.** Fewer boxes; harder to withdraw one thing, and weak under consent rules.

**Recommendation: A.** The code already offers exactly three separate purposes and deliberately excludes referral, generic marketing and any religious-response label (HC-02 §5.1). A keeps that and leaves room for HC-18.

**Engineering after approval.** HC-DEC1 implementation: add the purpose list and notice text per purpose; later add referral and event purposes. Unblocks HC-14 (withdrawal across all purposes) and HC-18. Size: **M**.

**Needs review: yes.** A privacy lawyer must confirm the lawful basis for each purpose and the notice wording. Religious beliefs can be special-category data in some places (for example under GDPR); qualified review is required before any real collection. Launch countries and minors are still open.

## Gate 2. Who sees pending responses (HC-DEC2)

**Question.** Who may see names and contact details of people who have not yet been verified?

**Options**
- **A. Owner/admin only.** Pastors and volunteers see nothing until verified, permission-scoped follow-up exists. Safest; admins must pass requests along manually.
- **B. Owner/admin plus all pastors.** Faster follow-up; broad exposure of sensitive data.
- **C. Owner/admin plus named volunteers.** Middle ground; needs a screening and assignment process first.

**Recommendation: A.** This is already the implemented default: owner/admin only, and the application cannot read names or contact methods (HC-02 §2, §5.2). HC-13 will add assignment-scoped counselor access properly.

**Engineering after approval.** HC-DEC2: confirm the access matrix, add the staff rights-request procedure and test every allowed and denied role. Unblocks HC-13 (cases and counselor assignment). Size: **S** (A); **L** for B or C.

**Needs review: security review yes; legal review no** for A. Any widening (B, C) would need both.

## Gate 3. After erasure (HC-DEC3)

**Question.** When someone is erased, what, if anything, do we keep?

**Options**
- **A. Delete everything.** No trace. Best for the person; loses simple campaign counts.
- **B. Coarse tombstone, short fixed period.** Keep only campaign, link, form version and day, for a bounded time. Hide counts for small groups. Balanced.
- **C. Tombstone kept indefinitely.** Best statistics; weakest privacy.

**Recommendation: B.** It matches today's CRM precedent and the code (HC-02 §3). The HC-02 review warned that even this coarse record may identify someone in a small group, so a time limit and small-group suppression are needed.

**Engineering after approval.** HC-DEC3: add the tombstone expiry, small-group suppression in reports and tests of erasure results. Unblocks HC-14 and HC-15 (aggregate metrics). Size: **M**. A would be **S**.

**Needs review: yes.** Privacy/legal review must judge how identifying small groups are and approve the retained fields and period.

## Gate 4. Retention (HC-DEC4)

**Question.** How long may we keep responses that nobody has verified?

**Options**
- **A. 30 days maximum for unverified; shorter per form allowed.** Verified records get purpose-specific caps after policy review.
- **B. 90 days maximum.** More time to follow up; more data held.
- **C. No platform maximum, ministry decides.** Flexible; no protection against an unsafe setting. Today's schema only blocks absurd values (1 to 36500 days).

**Recommendation: A.** There is no approved maximum yet, and the code requires each form to set its own duration (HC-02 §5.4). A short cap is the lower-risk starting point and can be loosened later.

**Engineering after approval.** HC-DEC4: enforce the maximum, add scheduled purge with failure alerts and tests. Unblocks real collection (HC-05) and HC-14. Size: **M**.

**Needs review: yes.** Legal review must approve the durations and the caps for verified records. Scheduled purging also needs monitoring set up before collection.

## Gate 5. Encrypting contact details (HC-DEC5)

**Question.** How do we protect email addresses and religious responses once real data is stored?

**Options**
- **A. Managed key service.** Encrypt before saving, with key rotation, restricted decryption, protected search and an audit trail. Strongest; most work.
- **B. Database encryption at rest only.** Already in place; does not protect against a compromised application.
- **C. Own keys held by the app.** The current local test approach; not acceptable for real data (HC-05 notes the test key is not a production design).

**Recommendation: A.** HC-05 and HC-07 already encrypt in the application with a local test key, so the structure exists. Production needs a managed key, rotation and recovery.

**Engineering after approval.** HC-DEC5: key service setup, rotation and recovery runbook, least-privilege decryption, audit logging and a restore rehearsal. Unblocks real intake and real invitation delivery (HC-05, HC-07) and HC-14. Size: **L**.

**Needs review: security review yes; legal review no.** An independent security review of the key design is required before storing real addresses. Choice of provider and hosting location may involve legal review of transfers.

## How to record approval

Do not edit this sheet to approve. Follow the closing instruction in [hc-02-activation-gates.md](hc-02-activation-gates.md): for each decision, record the date, approver, scope/jurisdiction, approved policy and supporting evidence in that register, then reconcile HC-02 §5 and Craft. Any gate not recorded there stays UNAPPROVED.
