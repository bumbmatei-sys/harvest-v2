import { describe, expect, it } from "vitest";
import { signUnsubscribe, verifyUnsubscribe, UNSUBSCRIBE_TTL_MS } from "@/lib/community-email-token";

const secret = "a-long-enough-test-secret-value", target = { tenantId: "t1", communityId: "c1", userId: "u.1" };

describe("unsubscribe token", () => {
  it("round-trips, even for ids that contain dots", () => {
    expect(verifyUnsubscribe(secret, signUnsubscribe(secret, target))).toEqual(target);
  });
  it("rejects a tampered payload or signature", () => {
    const [payload, mac] = signUnsubscribe(secret, target).split(".");
    const other = Buffer.from(JSON.stringify([1, "t1", "c1", "someone-else", Date.now() + 1000])).toString("base64url");
    expect(verifyUnsubscribe(secret, `${other}.${mac}`)).toBeNull();
    expect(verifyUnsubscribe(secret, `${payload}.${mac.slice(0, -2)}AA`)).toBeNull();
    expect(verifyUnsubscribe(secret, `${payload}`)).toBeNull();
  });
  it("rejects another secret, an expired token and malformed input", () => {
    const now = 1_800_000_000_000, token = signUnsubscribe(secret, target, now);
    expect(verifyUnsubscribe("a-different-long-test-secret", token, now)).toBeNull();
    expect(verifyUnsubscribe(secret, token, now + UNSUBSCRIBE_TTL_MS)).toBeNull();
    expect(verifyUnsubscribe(secret, token, now + UNSUBSCRIBE_TTL_MS - 1)).toEqual(target);
    for (const bad of ["", "x", "a.b.c", "!!.!!", "a".repeat(700)]) expect(verifyUnsubscribe(secret, bad)).toBeNull();
    expect(verifyUnsubscribe(secret, undefined as unknown as string)).toBeNull();
  });
  it("refuses to sign with a weak secret", () => {
    expect(() => signUnsubscribe("short", target)).toThrow("EMAIL_TOKEN_SECRET_INVALID");
  });
});
