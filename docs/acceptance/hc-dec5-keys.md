# HC-DEC5 key-management groundwork: acceptance record

Engineering groundwork for the founder-selected direction (managed key service, rotation, restricted decryption, protected search, audit trail). It does not approve Gate 5, choose a provider, or enable real collection. No migration (0045 not used).

## Delivered

- Provider-neutral `KeyProvider`, local test provider (`test-1`, env value), hard-disabled managed stub (`MANAGED_KEY_SERVICE_ENABLED = false`).
- Version 2 envelopes (invitation envelope column) carry `keyId`; version 1 envelopes (no key id) still open; tested including after a simulated key rotation.
- `rotateEnvelopes` over an injectable store: bounded batches, idempotent, compare-and-swap, counts-only output. Tested with an in-memory store.
- `decryptContactDetails`: the single audited opener, counts-only events through an injectable sink, fails closed on sink failure. Wired into invitation request, claim and dispatch.
- Source guard test: only the audited wrapper imports the raw opener; only intake, invitation and rotation modules import the crypto module.

## Decisions and limits

- No migration: the app role cannot write envelopes except through definer functions; grants were not widened. A production rotation store needs a later migration adding a definer pair (list a bounded page of `connect_invitations` rows with an envelope after an id cursor; compare-and-swap an envelope for a row), callable only by the rotation role, plus the same for any pending intake envelope store introduced later.
- The pending-intake receipt path still seals version 1 (`sealIntakeV1`, legacy key `legacy-1`). The definer functions from migrations 0028, 0029 and 0032 reject anything but version 1 with the exact key set, and no migration was allowed here. Only the invitation envelope column (object, at most 4096 bytes) accepts version 2. A later migration must relax that check to accept version 2 with `keyId` before receipt envelopes can be re-sealed or sealed under a managed key.
- Audit sink default is an in-process counter. A durable audit trail needs a later table and insert-only definer function; until then the audit is not durable evidence.
- Audit fails closed (decrypt throws `DECRYPT_AUDIT_UNAVAILABLE` if the sink fails). Conservative choice; revisit when a durable sink exists.
- Version 2 AAD is the binding, unchanged, so key id tampering is caught by key selection and authentication failure rather than AAD.
- Fingerprint, recipient-hash and capability HMAC keys use the current key id only. Rotating them changes stored values, so it needs a dual-key lookup design (protected search) and a migration; not attempted.
- Legacy version 1 envelopes are treated as key id `legacy-1`, mapped to the same secret as `test-1`. A managed provider must define how legacy ids resolve, or all version 1 envelopes must be re-sealed before it is enabled.
- Envelope size: version 2 adds about 25 bytes; the 4096-byte database check still holds.
- No vendor names, provider SDKs, network calls or real keys.

## Activation gates (all still required before real addresses are stored)

1. Provider choice (managed key service, region, contract).
2. Key ownership and rotation policy (who holds keys, rotation cadence, retired-key withdrawal rule).
3. Recovery runbook and restore rehearsal (including key loss and backup restore).
4. Independent security review of the key design.
5. Durable audit sink, production rotation store migration, and the protected-search design.
6. The remaining HC-02 activation decisions in docs/decisions/hc-02-activation-gates.md.
