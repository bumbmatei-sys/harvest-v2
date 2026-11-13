import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptAuditCounts, decryptContactDetails, resetDecryptAuditCounts, setDecryptAuditSink, type DecryptAuditEvent } from "../../src/server/connect-decrypt";
import { envelopeKeyId, intakeFingerprint, openIntake, sealIntake, sealIntakeV1, type SealedEnvelope } from "../../src/server/connect-intake-crypto";
import { MANAGED_KEY_SERVICE_ENABLED, createManagedKeyProvider, createTestKeyProvider, getKeyProvider, useKeyProvider } from "../../src/server/connect-key-provider";
import { rotateEnvelopes, type EnvelopeStore } from "../../src/server/connect-key-rotation";

const A = "a".repeat(64), B = "b".repeat(64);
const value = { email: "synthetic@example.test", token: "t" };
const provider = (current: string, retired: string[] = [], legacyFrom: string | undefined = "test-1") =>
  createTestKeyProvider({ keys: () => ({ "test-1": A, "test-2": B }), current, retired, legacyFrom });

beforeEach(() => { vi.stubEnv("HARVEST_CONNECT_TEST_KEY", A); resetDecryptAuditCounts(); });
afterEach(() => { useKeyProvider(null); setDecryptAuditSink(null); vi.unstubAllEnvs(); });

function legacySeal(v: unknown, binding: string): SealedEnvelope {
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(A, "hex"), "Harvest Connect", "pending-intake:v1", 32)), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv); c.setAAD(Buffer.from(binding));
  const ct = Buffer.concat([c.update(JSON.stringify(v), "utf8"), c.final()]);
  return { version: 1, binding, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ciphertext: ct.toString("base64") };
}

describe("key provider", () => {
  it("default provider is the local test key under id test-1; managed provider is hard disabled", () => {
    expect(getKeyProvider().currentKeyId("pending-intake:v1")).toBe("test-1");
    expect(MANAGED_KEY_SERVICE_ENABLED).toBe(false);
    const managed = createManagedKeyProvider();
    expect(() => managed.currentKeyId("pending-intake:v1")).toThrow("CONNECT_MANAGED_KEYS_DISABLED");
    expect(() => managed.resolveKey("pending-intake:v1", "x")).toThrow("CONNECT_MANAGED_KEYS_DISABLED");
    expect(() => managed.retiredKeyIds("pending-intake:v1")).toThrow("CONNECT_MANAGED_KEYS_DISABLED");
  });
  it("refuses unknown ids, unset or malformed keys; separates purposes and ids", () => {
    const p = provider("test-2", ["test-1"]);
    expect(p.retiredKeyIds("pending-intake:v1")).toEqual(["test-1", "legacy-1"]);
    expect(() => p.resolveKey("pending-intake:v1", "test-9")).toThrow("CONNECT_KEY_UNAVAILABLE");
    expect(p.resolveKey("pending-intake:v1", "test-1").equals(p.resolveKey("pending-intake:v1", "test-2"))).toBe(false);
    expect(p.resolveKey("pending-intake:v1", "test-1").equals(p.resolveKey("invitation-recipient:v1", "test-1"))).toBe(false);
    vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "short");
    expect(() => getKeyProvider().resolveKey("pending-intake:v1", "test-1")).toThrow("CONNECT_KEY_UNAVAILABLE");
    vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "");
    expect(() => getKeyProvider().currentKeyId("pending-intake:v1")).toThrow("CONNECT_KEY_UNAVAILABLE");
  });
});

describe("versioned envelopes", () => {
  it("seals as version 2 with the key id and keeps the version 1 field layout otherwise", () => {
    const sealed = sealIntake(value, "b1");
    expect(sealed).toMatchObject({ version: 2, keyId: "test-1", binding: "b1" });
    expect(openIntake(sealed, "b1")).toEqual(value);
  });
  it("still opens version 1 envelopes that have no key id, including after rotation of the current key", () => {
    const old = legacySeal(value, "b1");
    expect(envelopeKeyId(old)).toBe("legacy-1");
    expect(openIntake(old, "b1")).toEqual(value);
    useKeyProvider(provider("test-2", ["test-1"]));
    expect(openIntake(old, "b1")).toEqual(value);
  });
  it("opens by the recorded key id and refuses ids that are not current or retired", () => {
    const sealed = sealIntake(value, "b1");
    useKeyProvider(provider("test-2", ["test-1"]));
    expect(openIntake(sealed, "b1")).toEqual(value);
    expect(sealIntake(value, "b1").keyId).toBe("test-2");
    useKeyProvider(provider("test-2", []));
    expect(() => openIntake(sealed, "b1")).toThrow("CONNECT_KEY_UNAVAILABLE");
    expect(() => openIntake({ ...sealed, keyId: "test-2" }, "b1")).toThrow();
    expect(() => openIntake({ ...sealed, version: 3 } as unknown as SealedEnvelope, "b1")).toThrow("INVALID_ENVELOPE");
    expect(() => openIntake(sealed, "other")).toThrow("INVALID_ENVELOPE");
  });
  it("the receipt path seals version 1 under the legacy key, with exactly the stored key set", () => {
    const v1 = sealIntakeV1(value, "b1");
    expect(Object.keys(v1).sort()).toEqual(["binding", "ciphertext", "iv", "tag", "version"]);
    expect(openIntake(v1, "b1")).toEqual(value);
    useKeyProvider(provider("test-2", ["test-1"]));
    expect(openIntake(v1, "b1")).toEqual(value);
    useKeyProvider(createManagedKeyProvider());
    expect(() => sealIntakeV1(value, "b1")).toThrow();
  });
  it("keyed hashes keep their value under the default provider", () => {
    expect(intakeFingerprint({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("decryption audit", () => {
  it("records counts-only events and no values", () => {
    const events: DecryptAuditEvent[] = [], sealed = sealIntake(value, "secret-binding");
    expect(decryptContactDetails(sealed, "secret-binding", "invitation-dispatch", (e) => events.push(e))).toEqual(value);
    expect(() => decryptContactDetails(sealed, "wrong", "invitation-dispatch", (e) => events.push(e))).toThrow();
    expect(events).toEqual([
      { purpose: "invitation-dispatch", keyId: "test-1", envelopeVersion: 2, outcome: "ok" },
      { purpose: "invitation-dispatch", keyId: "test-1", envelopeVersion: 2, outcome: "failed" }]);
    const text = JSON.stringify(events);
    for (const secret of [value.email, "secret-binding", sealed.ciphertext]) expect(text).not.toContain(secret);
  });
  it("counts through the default sink and fails closed when the sink fails", () => {
    const sealed = sealIntake(value, "b");
    decryptContactDetails(sealed, "b", "invitation-claim");
    expect(() => decryptContactDetails(sealed, "x", "invitation-claim")).toThrow();
    expect(decryptAuditCounts()).toEqual({ "invitation-claim:ok": 1, "invitation-claim:failed": 1 });
    expect(() => decryptContactDetails(sealed, "b", "invitation-claim", () => { throw new Error("down"); })).toThrow("DECRYPT_AUDIT_UNAVAILABLE");
  });
  it("labels malformed key ids as invalid instead of echoing them", () => {
    const events: DecryptAuditEvent[] = [];
    const bad = { ...sealIntake(value, "b"), keyId: "x".repeat(200) };
    expect(() => decryptContactDetails(bad, "b", "invitation-claim", (e) => events.push(e))).toThrow();
    expect(events[0]).toMatchObject({ keyId: "invalid", outcome: "failed" });
  });
});

function memoryStore(rows: Record<string, SealedEnvelope>, hooks: { beforeReplace?: (id: string) => void } = {}): EnvelopeStore & { rows: Record<string, SealedEnvelope> } {
  return {
    rows,
    async list(after, limit) {
      const ids = Object.keys(rows).sort().filter((id) => after === null || id > after).slice(0, limit + 1);
      const page = ids.slice(0, limit);
      return { rows: page.map((id) => ({ id, envelope: rows[id] })), next: ids.length > limit ? page[page.length - 1] : null };
    },
    async replace(id, from, to) {
      hooks.beforeReplace?.(id);
      if (JSON.stringify(rows[id]) !== JSON.stringify(from)) return false;
      rows[id] = to; return true;
    },
  };
}

describe("rotation", () => {
  const seed = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${String(i).padStart(3, "0")}`, i % 2 ? legacySeal({ i }, `b${i}`) : sealIntake({ i }, `b${i}`)]));
  it("re-seals in bounded batches, is idempotent and reports counts only", async () => {
    const store = memoryStore(seed(7));
    useKeyProvider(provider("test-2", ["test-1"]));
    const first = await rotateEnvelopes(store, { batchSize: 3, maxBatches: 1 });
    expect(first).toMatchObject({ scanned: 3, resealed: 3, batches: 1, complete: false });
    const second = await rotateEnvelopes(store, { batchSize: 3, maxBatches: 10 });
    expect(second).toMatchObject({ scanned: 7, resealed: 4, alreadyCurrent: 3, failed: 0, conflicts: 0, complete: true });
    const third = await rotateEnvelopes(store, { batchSize: 500 });
    expect(third).toMatchObject({ scanned: 7, resealed: 0, alreadyCurrent: 7, complete: true });
    for (const [id, env] of Object.entries(store.rows)) {
      const n = Number(id.slice(1));
      expect(env).toMatchObject({ version: 2, keyId: "test-2", binding: `b${n}` });
      expect(openIntake(env, `b${n}`)).toEqual({ i: n });
    }
    expect(Object.keys(third).sort()).toEqual(["alreadyCurrent", "batches", "complete", "conflicts", "failed", "resealed", "scanned"]);
    // After rotation the retired key can be withdrawn.
    useKeyProvider(provider("test-2", [], undefined));
    expect(openIntake(store.rows.r003, "b3")).toEqual({ i: 3 });
  });
  it("clamps batch size, counts failures and conflicts, and audits each open under key-rotation", async () => {
    const rows = seed(3);
    rows.r001 = { ...legacySeal({}, "b1"), ciphertext: Buffer.from("corrupt").toString("base64") };
    const store = memoryStore(rows, { beforeReplace: (id) => { if (id === "r002") rows.r002 = { ...rows.r002 }; if (id === "r002") (rows.r002 as { iv: string }).iv = "changed"; } });
    useKeyProvider(provider("test-2", ["test-1"]));
    const events: DecryptAuditEvent[] = [];
    const out = await rotateEnvelopes(store, { batchSize: -5, auditSink: (e) => events.push(e) });
    expect(out).toMatchObject({ scanned: 3, failed: 1, conflicts: 1, complete: true });
    expect(events.every((e) => e.purpose === "key-rotation")).toBe(true);
  });
});
