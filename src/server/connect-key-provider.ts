import { hkdfSync } from "node:crypto";

// HC-DEC5 groundwork: provider-neutral key management for Connect envelopes and keyed hashes.
// No provider is selected or approved. The only working provider derives keys from a local test value.
export type KeyPurpose = "pending-intake:v1" | "intake-fingerprint:v1" | "submission-capability:v1" | "invitation-recipient:v1";
/** Key id carried by version 1 envelopes, which were sealed before envelopes recorded a key id. */
export const LEGACY_KEY_ID = "legacy-1";
export const TEST_KEY_ID = "test-1";

export interface KeyProvider {
  /** Key id new envelopes and hashes are created under. */
  currentKeyId(purpose: KeyPurpose): string;
  /** Key bytes for a purpose and id. Throws CONNECT_KEY_UNAVAILABLE for ids it does not hold or no longer allows. */
  resolveKey(purpose: KeyPurpose, keyId: string): Buffer;
  /** Retired ids that may still decrypt (never encrypt), including the legacy id when supported. */
  retiredKeyIds(purpose: KeyPurpose): readonly string[];
}

const unavailable = () => new Error("CONNECT_KEY_UNAVAILABLE");
const hex64 = /^[a-f0-9]{64}$/;
const derive = (secret: string, purpose: KeyPurpose) => {
  if (!hex64.test(secret)) throw unavailable();
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "hex"), "Harvest Connect", purpose, 32));
};

export type TestKeyConfig = {
  /** Read lazily on every call so tests may change the environment. */
  keys: () => Record<string, string | undefined>;
  current: string;
  retired?: readonly string[];
  /** Key id whose secret opens version 1 envelopes. Omit to refuse them. */
  legacyFrom?: string;
};
export function createTestKeyProvider(config: TestKeyConfig): KeyProvider {
  const secretFor = (id: string) => {
    const secret = config.keys()[id === LEGACY_KEY_ID && config.legacyFrom ? config.legacyFrom : id];
    if (!secret) throw unavailable();
    return secret;
  };
  const allowed = (id: string) => id === config.current || (config.retired ?? []).includes(id) || (id === LEGACY_KEY_ID && !!config.legacyFrom);
  return {
    currentKeyId: () => { secretFor(config.current); return config.current; },
    resolveKey: (purpose, id) => { if (!allowed(id)) throw unavailable(); return derive(secretFor(id), purpose); },
    retiredKeyIds: () => [...(config.retired ?? []), ...(config.legacyFrom ? [LEGACY_KEY_ID] : [])],
  };
}
/** Local synthetic-data provider backed by HARVEST_CONNECT_TEST_KEY. Not a production design. */
export const envTestKeyProvider = () => createTestKeyProvider({
  keys: () => ({ [TEST_KEY_ID]: process.env.HARVEST_CONNECT_TEST_KEY }), current: TEST_KEY_ID, legacyFrom: TEST_KEY_ID });

// Intentionally a constant, not an environment toggle (same pattern as COMMUNITY_EMAIL_LIVE_DELIVERY).
// Enabling needs a separate change: provider selection, key ownership, recovery runbook and independent security review.
export const MANAGED_KEY_SERVICE_ENABLED = false;
export function createManagedKeyProvider(): KeyProvider {
  const disabled = (): never => { throw new Error("CONNECT_MANAGED_KEYS_DISABLED"); };
  return { currentKeyId: disabled, resolveKey: disabled, retiredKeyIds: disabled };
}

let override: KeyProvider | null = null;
/** Test seam only. Pass null to restore the default. */
export const useKeyProvider = (provider: KeyProvider | null) => { override = provider; };
export const getKeyProvider = (): KeyProvider => override ?? (MANAGED_KEY_SERVICE_ENABLED ? createManagedKeyProvider() : envTestKeyProvider());
