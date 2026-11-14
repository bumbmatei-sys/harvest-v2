import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { associationConsentPurposes, connectOfferedPurposes, connectProjectedPurposes, consentPurposeRegistry, ledgerPurposes, MAX_OFFERED_PURPOSES, purposesWith, staffConsentPurposes } from "../../src/lib/consent-purposes";
import { connectPurposes } from "../../src/lib/connect-data";
import { intakePurposes, intakeRights, intakeSetup, intakeSubmission } from "../../src/lib/connect-intake";
import { consentInput, consentPurposes } from "../../src/lib/contact-input";
import { associationPurposes } from "../../src/db/schema";
import { associationInput } from "../../src/server/crm-associations";
import { crmEventContracts } from "../../src/server/crm-events";

const sorted = (list: readonly string[]) => [...list].sort();
const schemaSource = readFileSync(join(process.cwd(), "src/db/schema.ts"), "utf8");
/** The quoted purposes in a named check constraint of src/db/schema.ts. */
function schemaCheck(name: string) {
  const start = schemaSource.indexOf(`check("${name}"`);
  expect(start, `schema check ${name} exists`).toBeGreaterThan(-1);
  const end = schemaSource.indexOf("`)", start);
  return schemaSource.slice(start, end);
}
const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

describe("HC-DEC1 purpose registry", () => {
  it("defines exactly the three Connect purposes for now: referrals and events are not offered", () => {
    expect(sorted(connectOfferedPurposes)).toEqual(["account_communications", "newsletter", "outreach_follow_up"]);
    expect(MAX_OFFERED_PURPOSES).toBe(3);
    expect(Object.keys(consentPurposeRegistry)).not.toContain("referrals");
    expect(Object.keys(consentPurposeRegistry)).not.toContain("events");
    expect(Object.keys(consentPurposeRegistry)).not.toContain("referral");
  });
  it("derives every existing TypeScript list from the registry, with no private copies", () => {
    expect(consentPurposes).toEqual(staffConsentPurposes);
    expect(connectPurposes).toEqual(connectOfferedPurposes);
    expect(intakePurposes).toEqual(connectOfferedPurposes);
    expect(associationPurposes).toEqual(associationConsentPurposes);
    expect(sorted(consentPurposes)).toEqual(["account_communications", "event_administration", "form_follow_up", "marketing", "messaging", "newsletter", "outreach_follow_up"]);
    expect(sorted(associationPurposes)).toEqual(["form_follow_up", "messaging", "newsletter"]);
  });
  it("keeps legacy_unspecified as stored history that nothing can write, offer, project or gate on", () => {
    expect(ledgerPurposes).toContain("legacy_unspecified");
    for (const list of [staffConsentPurposes, connectOfferedPurposes, connectProjectedPurposes, associationConsentPurposes]) expect(list as readonly string[]).not.toContain("legacy_unspecified");
    expect(consentInput.safeParse({ channel: "email", status: "granted", purpose: "legacy_unspecified", noticeVersion: "notice-v1", source: "x", evidence: "x" }).success).toBe(false);
  });
  it("projects only purposes that are also offered, and never account_communications", () => {
    for (const projected of connectProjectedPurposes) expect(connectOfferedPurposes as readonly string[]).toContain(projected);
    expect(connectProjectedPurposes as readonly string[]).not.toContain("account_communications");
    expect(sorted(connectProjectedPurposes)).toEqual(["newsletter", "outreach_follow_up"]);
  });
  it("picks flags in registry order and refuses an empty derived list", () => {
    expect(purposesWith("association")).toEqual(["messaging", "form_follow_up", "newsletter"]);
  });
});

describe("HC-DEC1 schema constraints agree with the registry (source guard)", () => {
  it("consent_purpose lists the ledger purposes", () => expect(sorted(quoted(schemaCheck("consent_purpose")))).toEqual(sorted(ledgerPurposes)));
  it("crm_association_purpose lists the association purposes", () => expect(sorted(quoted(schemaCheck("crm_association_purpose")))).toEqual(sorted(associationConsentPurposes)));
  it("form_version_purposes and campaign_response_consent_purpose list the Connect purposes", () => {
    expect(sorted(quoted(schemaCheck("form_version_purposes")))).toEqual(sorted(connectOfferedPurposes));
    expect(sorted(quoted(schemaCheck("campaign_response_consent_purpose")))).toEqual(sorted(connectOfferedPurposes));
  });
  it("connect_intake_event_purpose logs withdrawals only for the projected purposes", () => {
    const body = schemaCheck("connect_intake_event_purpose");
    const withdraw = body.slice(body.indexOf("'withdraw' and"), body.indexOf(") or"));
    expect(sorted(quoted(withdraw.replace("'withdraw'", "")))).toEqual(sorted(connectProjectedPurposes));
  });
});

describe("HC-DEC1 validation never grants what was not offered and selected", () => {
  const submission = { submissionId: "0b8f57f9-6b8c-4d9c-9d3b-3c2f3f6a0001", receiptToken: "a".repeat(64), stamp: "b".repeat(64), capability: `${"1".repeat(13)}.${"c".repeat(32)}.${"d".repeat(64)}` };
  it("rejects a submission with no purpose, an unknown purpose or a purpose that belongs to another surface", () => {
    expect(intakeSubmission.safeParse({ ...submission, email: "a@example.test" }).success).toBe(false);
    expect(intakeSubmission.safeParse({ ...submission, purposes: [], email: "a@example.test" }).success).toBe(false);
    for (const purpose of ["referrals", "events", "marketing", "messaging", "form_follow_up", "event_administration", "legacy_unspecified"])
      expect(intakeSubmission.safeParse({ ...submission, purposes: [purpose], email: "a@example.test" }).success, purpose).toBe(false);
    expect(intakeSubmission.safeParse({ ...submission, purposes: ["newsletter", "newsletter"], email: "a@example.test" }).success).toBe(false);
    expect(intakeSubmission.safeParse({ ...submission, purposes: ["newsletter"], email: "a@example.test" }).success).toBe(true);
  });
  it("lets a guest withdraw only a Connect purpose, and one at a time", () => {
    const receiptToken = "a".repeat(64);
    expect(intakeRights.safeParse({ receiptToken, action: "withdraw" }).success).toBe(false);
    expect(intakeRights.safeParse({ receiptToken, action: "withdraw", purpose: "marketing" }).success).toBe(false);
    expect(intakeRights.safeParse({ receiptToken, action: "withdraw", purpose: ["newsletter", "outreach_follow_up"] }).success).toBe(false);
    for (const purpose of connectOfferedPurposes) expect(intakeRights.safeParse({ receiptToken, action: "withdraw", purpose }).success).toBe(true);
  });
  it("lets a form offer only registry purposes and never more than the cap", () => {
    const setup = { name: "Test", notice: "Test copy", retentionDays: 1, definition: { kind: "connect-intake-v2", syntheticOnly: true, preferredName: false, followUpChannel: "email" }, purposes: ["newsletter"] };
    expect(intakeSetup.safeParse(setup).success).toBe(true);
    expect(intakeSetup.safeParse({ ...setup, purposes: ["referrals"] }).success).toBe(false);
    expect(intakeSetup.safeParse({ ...setup, purposes: ["newsletter", "marketing"] }).success).toBe(false);
  });
  it("types association and event purposes from the same registry", () => {
    const base = { source: "zernio", kind: "message", contactId: "0b8f57f9-6b8c-4d9c-9d3b-3c2f3f6a0001" };
    for (const purpose of associationConsentPurposes) expect(associationInput.safeParse({ ...base, purpose }).success, purpose).toBe(true);
    for (const purpose of ["outreach_follow_up", "marketing", "account_communications", "referrals", "legacy_unspecified"]) expect(associationInput.safeParse({ ...base, purpose }).success, purpose).toBe(false);
    const recorded = { tenantId: "0b8f57f9-6b8c-4d9c-9d3b-3c2f3f6a0002", actorId: "u", associationId: "0b8f57f9-6b8c-4d9c-9d3b-3c2f3f6a0003", contactId: null, companyId: null,
      source: "form", kind: "message", occurredAt: "2026-11-01T00:00:00Z", summary: { redacted: true, length: 0 }, payload: { redacted: true } };
    expect(crmEventContracts["crm.association.recorded"].data.safeParse({ ...recorded, purpose: "newsletter" }).success).toBe(true);
    expect(crmEventContracts["crm.association.recorded"].data.safeParse({ ...recorded, purpose: "anything_else" }).success).toBe(false);
  });
});
