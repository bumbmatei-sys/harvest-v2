# HC-05 independent technical review

Reviewed implementation commit: `77b585196da7f55399c11e90dad9514146a6df45`, against `origin/main` (`b1da5a4f16f020084ed8ee29df17337f9e2ddc54`, merged HC-03). Separate review session; this reviewer did not write implementation source.

## Verdict

**MERGE-OK for the bounded local-synthetic HC-05 technical implementation; no unresolved blocking finding at this commit.** This is source-review acceptance, not runtime/visual verification, founder merge approval, live collection approval or deployment authorization. Any subsequent implementation delta needs fresh review; a final evidence/docs-only delta may be assessed separately.

## Scope reviewed

- Migration 0028's receipt, quota/revocation and guest/worker event tables; FORCE RLS, zero direct app grants, scoped migration-owner policies, trigger guards and narrow callable definers. Earlier merged migrations are not rewritten.
- Canonical Forms/published immutable versions/notices, pending responses, contact-method references and purpose evidence. Admin/member permissions and tenant/campaign/form ownership remain server-derived. Revisions produce new versions and require a new source link rather than silently changing historical foreign keys.
- Public source/form resolution, submitted stamp and offered-purpose/channel checks, row locks, receipt/submission serialization, transaction rollback, strict schemas and bounded HTTP bodies.
- Both independent opt-ins, one shared synthetic email, absence of implied consent, unchanged other-purpose withdrawal, no CRM association, no identity claim, no membership, no generic outbox/job or delivery side effect.
- AES-256-GCM envelopes with random IV and persisted authenticated binding, purpose-separated HKDF keys and keyed changed-body fingerprints; no plaintext email lookup index or contact-reading/decrypt API.
- Signed source/version presentation capability, receipt derivation and binding, finite proof lifetime, replay/conflict behavior, bounded revocation suppression, guest rights, canonical owner/contact erasure compatibility, expiry-only purge and operator CLI cleanup.
- Production hard-disable and explicit local/disposable-database synthetic gates, reserved test addresses, no-store/no-referrer public/rights responses and safe diagnostic/error behavior.
- Form settings, guest submission/receipt/rights components, frozen attempted payload, accurate pending copy, validation correction, preserved recovery proof for uncertain outcomes, separate future activation decisions and published test/evidence limitations.
- Test source, including actual restricted-owner migration/upgrade harness, real multi-connection suppression/erasure probes, HTTP limits/private failure tests and browser workflow assertions. This reviewer read those tests; their execution belongs to the author record below.

## Findings resolved during review

1. **Stale POST recreation after expiry/erasure:** signed ten-minute presentation proof now bounds suppression; proof validity is rechecked after lock waits. Each private receipt is derived from exactly one signed random presentation capability and submission verifies that binding. A fresh capability cannot reuse the old receipt, so a renewed saved request cannot outlive its recorded suppression window.
2. **Concurrent recreation during successful erasure/purge:** submission and guest rights serialize on the receipt hash. Legacy erasure paths that already hold the response row use a nonblocking receipt lock and abort atomically with retryable `40001` on contention, avoiding inverse-lock deadlock. Suppression is rechecked after response lookup/waits. Tests cover saved and changed-submission-ID requests around erase/purge commits and owner erasure contention.
3. **Phone request silently recorded as SMS permission:** the implemented preset and SQL source gate now support email only. Voice/phone requires a separate reviewed channel contract; no live support is claimed.
4. **Purge CLI could fail on `server-only` import and leave its pool open:** it now constructs its own Drizzle/pool, checks the restricted application role, preserves local synthetic gates and closes the pool in `finally`.
5. **Encryption AAD could not be reconstructed directly:** authenticated binding is now stored with the encrypted envelope and removed with it on erasure.
6. **Malformed UTF-8 returned a generic server error:** decoding failure now becomes a safe validation `400`.
7. **Mid-flight purpose edits could misrepresent receipt withdrawal choices:** first attempted payload is captured and frozen; receipt actions render from the captured purposes. A definite validation `400` unlocks correction; uncertain outcomes retain the exact request and recovery proof.
8. **Anonymous/system events cannot impersonate an authenticated actor in the generic audit ledger:** a restricted guest/worker event ledger records only scoped operational facts and enforces append-only behavior with controlled erase unlink/rekey/day coarsening.

No unresolved source-review blocker remains from these findings. Browser-detected contrast adjustment uses the existing outline control variant rather than weakening accessibility checks.

## Evidence provenance and limitations

**Reviewer execution:** source inspection only for HC-05. No application tests, database/browser suites, migrations, external writes, provider delivery or production access were performed by this independent reviewer. Do not attribute the author's results to an independent runtime rerun.

At review handoff, the author reported 259 unit tests passing, lint/typecheck passing, a complete earlier 355-test integration/RLS run, and final focused reruns of 17 HC-05 integration tests plus two actual restricted-owner migration/upgrade cases after the final proof adjustment. The author must record exact commands, versions, outcomes and any superseding suite counts in the acceptance/PR record. Build and final browser/visual results were still being completed when this report was written; they are not certified by this report. Final delivery head/CI must be checked separately.

The SQL capabilities trust the server to verify signed presentation proof, validate synthetic contact values and supply its checked deadline. A compromised application server or arbitrary execution as its database role is outside the inherited application/transaction-context trust boundary; the SQL settings are not an independent production activation control.

All five HC-02 activation decisions remain **UNAPPROVED**. Test encryption is not production key lifecycle/recovery design; test quotas are not crowd/shared-Wi-Fi safety evidence. No hosted populated-upgrade, physical-device/camera/print QA, production scheduler, downstream fulfillment, live policy, legal/privacy/safeguarding signoff or real collection approval is implied. Those boundaries are accurately documented as future activation work, not completed product capabilities.

## Browser-driven correction delta

Separately reviewed the post-`77b5851` source/test delta: the guest response form now uses a synchronous `onSubmit` handler with `preventDefault`, a busy guard and `new FormData(event.currentTarget)`, rather than an immediately resolving React form action. This prevents React's successful-action reset from clearing checkbox controls while asynchronous validation is still pending; native form validation and the captured exact-retry payload remain intact. **Delta accepted, no new blocker.** The HC-03 browser assertion now matches the current truthful no-real-collection copy; HC-05 explicitly exercises keyboard Space selection and the invalid-synthetic-email correction path. Final execution results belong to the author record. No tests or source edits were performed by this reviewer for the delta.

## Final copy and error-display delta

Reviewed the subsequent landing/error-display source delta separately. Available synthetic forms now show test-form copy rather than the older “available later” description. Guest submission and rights components map known HTTP validation/conflict/limit/unavailable statuses to reviewed catalogue strings; they do not display raw backend errors, alter authorization, or convert a failed rights request into an acknowledgement. Unknown failures retain the existing safe generic mapping. **Delta accepted, no new blocker.** The added validation-message browser assertion and split top/lower settings captures improve observable evidence; their execution and visual assessment remain the author's responsibility. No runtime tests were run by this reviewer.

## Settings/recovery form and top-of-page contrast delta

Reviewed the final narrow UI delta: admin settings and recovery-rights forms now use explicit synchronous `onSubmit`/`preventDefault` handlers with busy guards, preserving configured fields and recovery selections through asynchronous results without changing their server-side contracts. The settings Back control uses the existing outline variant to resolve the observed light-theme contrast issue. Browser evidence adds a separate settings-top axe scan, paired top/lower captures and an assertion that the configured form name remains after publication. **Delta accepted; no new blocker or authorization/schema/SQL change.** Final browser and visual outcomes remain author-executed evidence; no runtime tests were run by this reviewer.
