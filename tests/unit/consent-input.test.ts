import { describe, expect, it, vi } from "vitest";
import { consentInput, erasureInput } from "../../src/lib/contact-input";
import { can } from "../../src/server/permissions";

const proof = { channel: "email", status: "granted", purpose: "marketing", noticeVersion: "notice-v1", source: "Form reference", evidence: "Submission reference" };
describe("consent provenance and erasure boundaries", () => {
  it("accepts separate occurrence time and rejects personal text in retained purpose/version fields", () => {
    expect(consentInput.parse({ ...proof, occurredAt: "2026-10-01T12:30:00Z" }).occurredAt).toBe("2026-10-01T12:30:00Z");
    expect(consentInput.safeParse({ ...proof, purpose: "private@example.test" }).success).toBe(false);
    expect(consentInput.safeParse({ ...proof, noticeVersion: "Private Person" }).success).toBe(false);
    expect(consentInput.safeParse({ ...proof, occurredAt: "yesterday" }).success).toBe(false);
  });
  it("rejects caller-provided tenant, actor and recorded time, and requires explicit erasure confirmation", () => {
    for (const key of ["tenantId", "recordedBy", "recordedAt"]) expect(consentInput.safeParse({ ...proof, [key]: "forged" }).success).toBe(false);
    expect(erasureInput.safeParse({ confirm: "erase" }).success).toBe(true);
    expect(erasureInput.safeParse({}).success).toBe(false);
    expect(erasureInput.safeParse({ confirm: "erase", tenantId: "forged" }).success).toBe(false);
  });
  it("bounds occurrence time at validation time, including offsets and the five-minute edge", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
      expect(consentInput.safeParse({ ...proof, occurredAt: "2026-11-04T12:05:00Z" }).success).toBe(true);
      expect(consentInput.safeParse({ ...proof, occurredAt: "2026-11-04T13:05:00.001+01:00" }).success).toBe(false);
      expect(consentInput.safeParse({ ...proof, occurredAt: "2099-01-01T00:00:00Z" }).success).toBe(false);
      vi.setSystemTime(new Date("2026-11-04T13:00:00Z"));
      expect(consentInput.safeParse({ ...proof, occurredAt: "2026-11-04T13:05:00Z" }).success).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("restricts erasure to owners and admins", () => {
    for (const role of ["owner", "admin"]) expect(can(role, "contacts:erase")).toBe(true);
    for (const role of ["member", "viewer", "unknown"]) expect(can(role, "contacts:erase")).toBe(false);
  });
});
