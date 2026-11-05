import { describe, expect, it } from "vitest";
import { backoffMs, jobInput, workFingerprint } from "../../src/server/jobs/primitives";
import { can } from "../../src/server/permissions";
import { signSyntheticWebhook, syntheticEvent, verifySyntheticSignature } from "../../src/server/webhooks/synthetic";

const connection = { id: "fixture", tenantId: "00000000-0000-4000-8000-000000000001", signingKey: "synthetic-test-key-that-is-never-a-provider-secret" };
const timestamp = "1793870000", now = Number(timestamp) * 1000;
const body = Buffer.from('{ "id": "event-1", "data": { "value": "ready" } }');
describe("durable work invariants", () => {
  it("fingerprints semantic object content deterministically, including nested keys", () => {
    expect(workFingerprint("receipt", { b: [1, { z: false, a: null }], a: 2 }))
      .toBe(workFingerprint("receipt", { a: 2, b: [1, { a: null, z: false }] }));
    expect(workFingerprint("receipt", { a: [1, 2] })).not.toBe(workFingerprint("receipt", { a: [2, 1] }));
    expect(workFingerprint("receipt", {})).not.toBe(workFingerprint("other", {}));
    expect(workFingerprint("receipt", { a: 1 })).not.toBe(workFingerprint("receipt", { a: "1" }));
  });
  it("backs off exponentially and caps retries at one hour", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(13)).toBe(3_600_000); expect(backoffMs(1000)).toBe(3_600_000);
    for (const invalid of [0, -1, 1.5, NaN, Infinity]) expect(() => backoffMs(invalid)).toThrow("INVALID_ATTEMPT");
  });
  it("validates job keys, JSON payloads, dates and retry budgets", () => {
    const input = { kind: "domain.receipt", idempotencyKey: "one", payload: {} };
    expect(jobInput.parse(input).maxAttempts).toBe(5);
    for (const extra of [{ idempotencyKey: "" }, { payload: [] }, { payload: { n: Infinity } }, { maxAttempts: 0 }, { maxAttempts: 21 }, { scheduledFor: new Date(NaN) }]) {
      expect(jobInput.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });
  it.each(["owner", "admin", "member", "viewer", "unknown"])("restricts queue inspection and operation for %s", (role) => {
    for (const permission of ["jobs:read", "jobs:operate"] as const) expect(can(role, permission)).toBe(["owner", "admin"].includes(role));
  });
});
describe("synthetic raw-body signature contract", () => {
  it("accepts the exact raw bytes and rejects body reformatting", () => {
    const signature = signSyntheticWebhook(body, connection.id, connection.signingKey, timestamp);
    expect(verifySyntheticSignature(body, connection, timestamp, signature, now)).toBe(true);
    expect(verifySyntheticSignature(Buffer.from(JSON.stringify(JSON.parse(body.toString()))), connection, timestamp, signature, now)).toBe(false);
    expect(verifySyntheticSignature(body, { ...connection, id: "other" }, timestamp, signature, now)).toBe(false);
    expect(verifySyntheticSignature(body, { ...connection, signingKey: "wrong" }, timestamp, signature, now)).toBe(false);
  });
  it("checks stale/future timestamps, malformed signatures and tolerance boundaries", () => {
    const signature = signSyntheticWebhook(body, connection.id, connection.signingKey, timestamp);
    for (const drift of [-301_000, 301_000]) expect(verifySyntheticSignature(body, connection, timestamp, signature, now + drift)).toBe(false);
    for (const drift of [-300_000, 300_000]) expect(verifySyntheticSignature(body, connection, timestamp, signature, now + drift)).toBe(true);
    for (const bad of [null, "", "f", "g".repeat(64), "f".repeat(66)]) expect(verifySyntheticSignature(body, connection, timestamp, bad, now)).toBe(false);
    for (const bad of [null, "", "NaN", "1e9", `${timestamp}.0`]) expect(verifySyntheticSignature(body, connection, bad, signature, now)).toBe(false);
  });
  it("requires a provider sequence and a bounded, synthetic-only data shape", () => {
    const event = { id: "event", resourceId: "resource", sequence: 2, occurredAt: "2026-11-05T12:00:00Z", data: { value: "ready" } };
    expect(syntheticEvent.safeParse(event).success).toBe(true);
    for (const patch of [{ sequence: -1 }, { sequence: 2.5 }, { sequence: 2_147_483_648 }, { data: { email: "private" } }, { tenantId: connection.tenantId }]) {
      expect(syntheticEvent.safeParse({ ...event, ...patch }).success).toBe(false);
    }
  });
});
