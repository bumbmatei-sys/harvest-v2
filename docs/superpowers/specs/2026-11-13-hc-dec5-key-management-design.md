# HC-DEC5 key-management groundwork (design)

Status: engineering groundwork only. Gate 5 (key custody) stays UNAPPROVED, no provider is chosen, real collection stays hard-disabled. Direction chosen by the founder: managed key service with rotation, restricted decryption, protected search and an audit trail (decision sheet Gate 5, Option A).

## Scope

1. `KeyProvider` (src/server/connect-key-provider.ts): current key id per purpose, key by purpose and id, retired ids still allowed to decrypt. A local test provider (env value, id `test-1`, also opens version 1 envelopes as `legacy-1`) and a managed stub guarded by `MANAGED_KEY_SERVICE_ENABLED = false` that throws.
2. Envelope versioning: version 2 records `keyId`; version 1 (no key id) still opens. AAD is unchanged (the binding), so existing readers of the layout keep working.
3. Rotation (src/server/connect-key-rotation.ts): `rotateEnvelopes(store, {batchSize, maxBatches})` over an injectable `EnvelopeStore` (list page, compare-and-swap replace). Idempotent, bounded (batch 1..500), counts only.
4. Decryption audit (src/server/connect-decrypt.ts): `decryptContactDetails(envelope, binding, purpose)` is the one opener. It emits a counts-only event (purpose, key id, envelope version, outcome) to an injectable sink and fails closed if the sink throws. Default sink is an in-process counter.
5. Restricted decryption: the invitation request, claim and dispatch paths and rotation are the only callers. `tests/unit/connect-crypto-guard.test.ts` fails if any other module imports the raw opener or the crypto module.

## Non-goals

No provider SDK, network call or real key. No migration, no grant change, no UI. Fingerprint, recipient-hash and capability keys use the current key id only; their rotation and the protected-search design are later work.

Receipt envelopes stay version 1: the definer functions of 0028, 0029 and 0032 pin `version = 1` and the exact key set, so `sealIntakeV1` seals them under the legacy key. Version 2 is used where the column does not pin the layout (invitation envelopes).

## Why no migration

Envelopes live in `connect_invitations.envelope` (jsonb, check: object, at most 4096 bytes; version 2 adds about 25 bytes) and, pending, behind the definer function `connect_invitation_pending`. The app role reads and writes them only through definer functions, so a production store for rotation needs new definer functions. That is deferred (see acceptance record).
