import { afterEach, describe, expect, it } from "vitest";
import { createTestKeyProvider, useKeyProvider } from "../../src/server/connect-key-provider";
import { credentialBinding, openCredential, sealCredential } from "../../src/server/social/credential-envelope";
import { webhookSecrets } from "../../src/server/social/webhook-secrets";

afterEach(() => useKeyProvider(null));
const provider = (current = "test-1", retired: string[] = []) => createTestKeyProvider({ keys: () => ({ "test-1": "11".repeat(32), "test-2": "22".repeat(32) }), current, retired });
const canary = "api-key-canary-93b1f0";

describe("sealed provider credentials", () => {
  it("round-trips, never contains the plaintext, and records the key id", () => {
    useKeyProvider(provider());
    const envelope = sealCredential({ secret: canary }, credentialBinding("t1", "c1"));
    expect(JSON.stringify(envelope)).not.toContain(canary);
    expect(envelope).toMatchObject({ version: 1, keyId: "test-1", binding: "social-credential:t1:c1" });
    expect(openCredential(envelope, credentialBinding("t1", "c1"))).toEqual({ secret: canary });
  });
  it("is bound to its tenant and connection and detects tampering", () => {
    useKeyProvider(provider());
    const envelope = sealCredential({ secret: canary }, credentialBinding("t1", "c1"));
    expect(() => openCredential(envelope, credentialBinding("t2", "c1"))).toThrow("INVALID_ENVELOPE");
    expect(() => openCredential({ ...envelope, binding: credentialBinding("t2", "c1") }, credentialBinding("t2", "c1"))).toThrow();
    const flipped = { ...envelope, ciphertext: Buffer.from(Buffer.from(envelope.ciphertext, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
    expect(() => openCredential(flipped, credentialBinding("t1", "c1"))).toThrow();
    for (const bad of [null, {}, { ...envelope, version: 2 }, "text"]) expect(() => openCredential(bad, credentialBinding("t1", "c1"))).toThrow("INVALID_ENVELOPE");
  });
  it("opens an envelope sealed under a retired key after rotation, and refuses one whose key was removed", () => {
    useKeyProvider(provider("test-1"));
    const envelope = sealCredential({ secret: canary }, "b");
    useKeyProvider(provider("test-2", ["test-1"]));
    expect(openCredential(envelope, "b")).toEqual({ secret: canary });
    expect(sealCredential({ secret: canary }, "b").keyId).toBe("test-2");
    useKeyProvider(provider("test-2"));
    expect(() => openCredential(envelope, "b")).toThrow("CONNECT_KEY_UNAVAILABLE");
  });
  it("separates the credential key from the webhook secret and derives the latter without storing it", () => {
    useKeyProvider(provider("test-2", ["test-1"]));
    const secrets = webhookSecrets();
    expect(secrets).toHaveLength(2); expect(secrets.every((s) => /^[a-f0-9]{64}$/.test(s))).toBe(true);
    expect(secrets[0]).not.toBe(secrets[1]);
    useKeyProvider(createTestKeyProvider({ keys: () => ({}), current: "test-1" }));
    expect(() => webhookSecrets()).toThrow("CONNECT_KEY_UNAVAILABLE");
  });
});
