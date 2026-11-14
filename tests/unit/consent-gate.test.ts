import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { decideConsent, type LedgerEvent } from "../../src/server/consent-gate";
import { consentPurposeRegistry, grantCountsOnChannel, purposeGrantChannels, purposesWith, staffConsentPurposes, type ConsentChannel, type ConsentPurpose } from "../../src/lib/consent-purposes";
import { CONSENT_GATE_EXEMPTIONS, checkSenders, importsSender, inspectSender, referencesConsentGate } from "../../scripts/source-guards";
import { consentInput, CONSENT_EARLIEST } from "../../src/lib/contact-input";
import { can } from "../../src/lib/permissions";
import { renderEmail, INSTANT_KINDS, type EmailItem, type EmailJob } from "../../src/lib/community-email";

// HC-DEC1b. Engineering defaults, UNAPPROVED pending legal review. Pure tests: no database, nothing is sent.
const purposes = Object.keys(consentPurposeRegistry) as ConsentPurpose[];
const channels: ConsentChannel[] = ["email", "sms", "social"];
let n = 0;
const ev = (status: "granted" | "withdrawn" | "unknown", channel: ConsentChannel, outstanding = false): LedgerEvent =>
  ({ id: `e${++n}`, status, channel, occurred_at: "2026-01-01", recorded_at: "2026-01-01", source: null, outstanding: status === "withdrawn" && outstanding });
// Ledger shapes, newest first. A withdrawal is `outstanding` unless a later grant on its channel supersedes it (computed in SQL).
const shapes: Record<string, () => LedgerEvent[]> = {
  none: () => [],
  email_grant: () => [ev("granted", "email")],
  sms_grant: () => [ev("granted", "sms")],
  social_grant: () => [ev("granted", "social")],
  email_grant_sms_withdrawal: () => [ev("withdrawn", "sms", true), ev("granted", "email")],
  sms_grant_email_withdrawal: () => [ev("withdrawn", "email", true), ev("granted", "sms")],
  email_withdrawn: () => [ev("withdrawn", "email", true), ev("granted", "email")],
  email_regranted: () => [ev("granted", "email"), ev("withdrawn", "email", false), ev("granted", "email")],
  email_unknown_after_grant: () => [ev("unknown", "email"), ev("granted", "email")],
};

describe("decideConsent: purposes x channels x ledger shapes", () => {
  // Expected from the stated rule, written independently of the implementation.
  const expected = (purpose: ConsentPurpose, shape: string, channel: ConsentChannel): "allowed" | "consent_missing" | "consent_withdrawn" | "purpose_not_contactable" | "channel_not_permitted" => {
    if (purpose === "legacy_unspecified") return "purpose_not_contactable";
    if (purpose === "newsletter" && channel !== "email") return "channel_not_permitted";
    const rows = shapes[shape]();
    if (rows.some((row) => row.outstanding)) return "consent_withdrawn";
    const latest = new Map<string, LedgerEvent>();
    for (const row of rows) if (!latest.has(row.channel)) latest.set(row.channel, row);
    const grantOn = (c: string) => latest.get(c)?.status === "granted" && (purpose !== "newsletter" || c === "email");
    return grantOn(channel) ? "allowed" : "consent_missing";
  };
  const cases = purposes.flatMap((purpose) => Object.keys(shapes).flatMap((shape) => channels.map((channel) => [purpose, shape, channel] as const)));
  it.each(cases)("%s / %s / %s", (purpose, shape, channel) => {
    const decision = decideConsent(shapes[shape](), purpose, channel);
    expect(decision.allowed ? "allowed" : decision.reason).toBe(expected(purpose, shape, channel));
  });
  it("covers every purpose, channel and shape", () => expect(cases).toHaveLength(purposes.length * Object.keys(shapes).length * channels.length));
  it("without a channel (the association gate) a grant on any accepted channel allows; the newsletter accepts email only", () => {
    expect(decideConsent(shapes.sms_grant(), "messaging").allowed).toBe(true);
    expect(decideConsent(shapes.social_grant(), "form_follow_up").allowed).toBe(true);
    expect(decideConsent(shapes.email_grant(), "newsletter").allowed).toBe(true);
    expect(decideConsent(shapes.sms_grant(), "newsletter")).toMatchObject({ allowed: false, reason: "consent_missing" });
    expect(decideConsent(shapes.social_grant(), "newsletter")).toMatchObject({ allowed: false, reason: "consent_missing" });
  });
  it("a withdrawal on any channel blocks every purpose, and never returns personal data in the reason", () => {
    for (const purpose of purposes.filter((item) => item !== "legacy_unspecified")) {
      const decision = decideConsent(shapes.email_grant_sms_withdrawal(), purpose);
      expect(decision).toMatchObject({ allowed: false, reason: "consent_withdrawn" });
      expect(decision.allowed ? "" : decision.reason).toMatch(/^[a-z_]+$/);
    }
  });
  it("fails closed for an unknown purpose", () => expect(decideConsent(shapes.email_grant(), "referrals" as ConsentPurpose)).toMatchObject({ allowed: false, reason: "purpose_not_contactable" }));
});

describe("newsletter channel scope and frozen registry lists", () => {
  it("only the newsletter is email-scoped; messaging and form_follow_up are unchanged", () => {
    expect(Object.keys(purposeGrantChannels)).toEqual(["newsletter"]);
    expect(grantCountsOnChannel("newsletter", "email")).toBe(true);
    for (const channel of ["sms", "social"]) expect(grantCountsOnChannel("newsletter", channel)).toBe(false);
    for (const purpose of purposes.filter((item) => item !== "newsletter")) for (const channel of channels) expect(grantCountsOnChannel(purpose, channel)).toBe(true);
  });
  it("derived purpose lists are frozen", () => {
    expect(Object.isFrozen(staffConsentPurposes)).toBe(true);
    expect(Object.isFrozen(purposesWith("association"))).toBe(true);
    expect(Object.isFrozen(purposeGrantChannels)).toBe(true);
    expect(() => (staffConsentPurposes as unknown as string[]).push("x")).toThrow();
  });
});

describe("staff attestation rules", () => {
  it("only owners and admins may attest; members and viewers may not, and unknown roles are denied", () => {
    expect(can("owner", "contacts:attest_consent")).toBe(true);
    expect(can("admin", "contacts:attest_consent")).toBe(true);
    for (const role of ["member", "viewer", "pastor", "volunteer", ""]) expect(can(role, "contacts:attest_consent")).toBe(false);
  });
  const base = { channel: "email", status: "granted", purpose: "newsletter", noticeVersion: "notice-v1", source: "Signed form", evidence: "Paper form 12" } as const;
  it("requires a non-empty method and evidence, and a date that is neither in the future nor implausibly old", () => {
    expect(consentInput.safeParse(base).success).toBe(true);
    expect(consentInput.safeParse({ ...base, source: "  " }).success).toBe(false);
    expect(consentInput.safeParse({ ...base, evidence: "" }).success).toBe(false);
    expect(consentInput.safeParse({ ...base, occurredAt: new Date(Date.now() + 3_600_000).toISOString() }).success).toBe(false);
    expect(consentInput.safeParse({ ...base, occurredAt: "1969-12-31T00:00:00Z" }).success).toBe(false);
    expect(consentInput.safeParse({ ...base, occurredAt: new Date(CONSENT_EARLIEST - 1).toISOString() }).success).toBe(false);
    expect(consentInput.safeParse({ ...base, occurredAt: new Date(CONSENT_EARLIEST).toISOString() }).success).toBe(true);
    expect(consentInput.safeParse({ ...base, occurredAt: new Date(Date.now() - 86_400_000).toISOString() }).success).toBe(true);
  });
  it("legacy_unspecified is not staff-recordable", () => expect(consentInput.safeParse({ ...base, purpose: "legacy_unspecified" }).success).toBe(false));
});

describe("consent-gate source guard", () => {
  const fake = (extra = "") => `import { Resend } from "resend";\nexport const send = (to: string) => new Resend("k").emails.send({ to });\n${extra}`;
  it("fails a fake sender module that omits the gate", () => {
    expect(inspectSender(fake(), "src/server/newsletter-sender.ts")).toEqual([expect.objectContaining({ rule: "consent-gate" })]);
  });
  it("fails when only a known sender entry point is imported", () => {
    for (const from of ["./community-email-sender", "./connect-invitation-email", "./email", "@/server/email", "nodemailer", "twilio", "zernio/sdk"]) {
      expect(inspectSender(`import { x } from "${from}";\nx();`, "src/server/auto-dm.ts"), from).toHaveLength(1);
    }
    expect(inspectSender(`const m = await import("resend");`, "src/server/x.ts")).toHaveLength(1);
    expect(inspectSender(`const m = require("resend");`, "src/server/x.ts")).toHaveLength(1);
  });
  it("passes a sender that imports the gate and calls mayContact", () => {
    const ok = fake(`import { mayContact } from "./consent-gate";\nexport const guarded = (tx: unknown) => mayContact(tx, "t", "c", "newsletter", "email");`);
    expect(inspectSender(ok, "src/server/newsletter-sender.ts")).toEqual([]);
  });
  it("does not accept a mere mention, a gate import without a call, or a comment-only reference", () => {
    expect(inspectSender(fake(`import { mayContact } from "./consent-gate";`), "src/server/a.ts")).toHaveLength(1);
    expect(inspectSender(fake(`// consent-gate mayContact(`), "src/server/a.ts")).toHaveLength(1);
    expect(referencesConsentGate(`import { mayContact } from "@/server/consent-gate"; mayContact(a)`)).toBe(true);
  });
  it("ignores modules that import no sender", () => expect(inspectSender(`import { sql } from "drizzle-orm";`, "src/server/x.ts")).toEqual([]));
  it("the repository has no ungated sender module", () => expect(checkSenders()).toEqual([]));
  it("every exemption still exists, still imports a sender and is not gate-using (no stale exemptions)", () => {
    for (const file of Object.keys(CONSENT_GATE_EXEMPTIONS)) {
      const source = readFileSync(file, "utf8");
      expect(importsSender(source), file).toBe(true);
      expect(referencesConsentGate(source), `${file} uses the gate; drop the exemption`).toBe(false);
      expect(CONSENT_GATE_EXEMPTIONS[file].length, file).toBeGreaterThan(20);
    }
  });
});

describe("community decision emails are fixed-template service messages (F5)", () => {
  // Classified account_communications-type service messages, UNAPPROVED pending legal review. Never routed through the consent ledger.
  const item = (kind: EmailItem["kind"], over: Partial<EmailItem> = {}): EmailItem => ({ kind, targetType: "application", count: 1, actorName: null, postTitle: null, postId: null, detail: {}, ...over });
  const job = (items: EmailItem[]): EmailJob => ({ id: "d1", kind: "instant", to: "m@example.test", name: "Mia", tenantId: "t1", communityId: "c1", recipientId: "u1", communityName: "Grace Group", communitySlug: "grace", hasMembership: true, items });
  const messages = JSON.parse(readFileSync("messages/en.json", "utf8"));
  it("the instant kinds are exactly the four decision kinds", () => expect([...INSTANT_KINDS]).toEqual(["application", "warning", "held_decision", "appeal_decision"]));
  it("the renderer passes only the allowed variables to the fixed message templates", () => {
    const source = readFileSync("src/lib/community-email.ts", "utf8");
    const allowed = new Set(["community", "summary", "count", "name", "others", "url"]);
    const used = new Set<string>();
    const sf = ts.createSourceFile("community-email.ts", source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === "message" && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
        for (const property of node.arguments[1].properties) used.add(property.name?.getText(sf) ?? "?");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) expect(allowed.has(key), `unexpected template variable ${key}`).toBe(true);
    // No free-text fields beyond the existing ones: a mail carries no body, message or content property.
    expect(source).not.toMatch(/\b(?:body|content|html|campaign|newsletter|marketing|promo)\b\s*[:=]/i);
  });
  it("the fixed templates contain no newsletter, marketing or outreach language and no links of their own", () => {
    const templates = { ...messages.CommunityEmail, ...Object.fromEntries(Object.entries(messages.CommunityNotifications.summary).map(([k, v]) => [`summary.${k}`, v])) } as Record<string, string>;
    for (const [key, text] of Object.entries(templates)) {
      expect(text, key).not.toMatch(/https?:\/\/|www\./i);
      expect(text, key).not.toMatch(/newsletter|marketing|promotion|special offer|donate|give now|follow[- ]?up|campaign/i);
    }
  });
  it("rendered decision mail links only to the community's own pages and its unsubscribe, and nothing else", () => {
    const origin = "http://127.0.0.1:3100", secret = "a-long-enough-test-secret-value";
    for (const kind of INSTANT_KINDS) {
      const text = renderEmail(job([item(kind, { detail: { status: "approved", decision: "approve" } })]), { origin, secret, now: 1_800_000_000_000 }).text;
      for (const url of text.match(/https?:\/\/\S+/g) ?? []) expect(url, `${kind}: ${url}`).toMatch(/^http:\/\/127\.0\.0\.1:3100\/(?:communities\/|account\/communities)/);
      expect(text).not.toMatch(/newsletter|marketing|donate/i);
    }
  });
  it("member-written text cannot add a link to a decision email", () => {
    const text = renderEmail(job([item("warning", { actorName: "Visit https://evil.com/offer now", postTitle: "Sign up at evil.com/newsletter" })]), { origin: "http://127.0.0.1:3100", secret: "a-long-enough-test-secret-value", now: 1_800_000_000_000 }).text;
    expect(text).not.toContain("evil.com");
  });
});

describe("crmEnvelope drops are counted, not silent (reviewer note from HC-DEC1)", () => {
  it("counts unknown kinds and invalid payloads and logs fixed codes only", async () => {
    const { vi } = await import("vitest");
    const { crmEnvelope, crmEnvelopeDrops } = await import("../../src/server/crm-events");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const row = { id: "e1", tenantId: "t1", createdAt: new Date(0), payload: { secret: "person@example.test" } };
    const before = { ...crmEnvelopeDrops };
    expect(crmEnvelope({ ...row, kind: "crm.nothing" })).toBeNull();
    expect(crmEnvelope({ ...row, kind: "crm.person.consent_recorded" })).toBeNull();
    expect(crmEnvelopeDrops.unknownKind).toBe(before.unknownKind + 1);
    expect(crmEnvelopeDrops.invalidPayload).toBe(before.invalidPayload + 1);
    expect(spy.mock.calls.map((call) => call.join(" "))).toEqual(["crm_envelope_unknown_kind", "crm_envelope_invalid_payload"]);
    spy.mockRestore();
  });
});
