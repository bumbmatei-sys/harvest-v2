import { describe, expect, it } from "vitest";
import { formDefinitionSchema, type FormDefinition } from "../../src/lib/crm-forms";
import { AD_CONSENT_IDS, adConsentPurpose, adFormIssues, adFormSpec, adWordings, stampAdsForm } from "../../src/lib/ads/lead-form";
import { buildAdLeadForm, hasAdConsent, setAdConsent } from "../../src/lib/ads/lead-form-builder";

const t = (key: string) => key;
const now = "2026-11-25T00:00:00.000Z";
const base = () => buildAdLeadForm(t, "meta", "https://example.test/privacy", "Grace Church", now);
const full = () => (["newsletter", "followUp", "marketing"] as const).reduce((form, kind) => setAdConsent(form, kind, true, "Grace Church"), base());

describe("ad lead forms on the shared forms model", () => {
  it("starts with name, email, phone and the notice, and no consent question", () => {
    const form = base();
    expect(formDefinitionSchema.safeParse(form).success).toBe(true);
    expect(form.destination).toBeNull();
    expect(form.blocks.map((b) => b.type)).toEqual(["short", "email", "phone", "consent"]);
    for (const kind of ["newsletter", "followUp", "marketing"] as const) expect(hasAdConsent(form, kind)).toBe(false);
    expect(adFormIssues(form)).toEqual([]);
    expect(form.blocks.at(-1)?.text).toBe("Your details go to Grace Church. You can ask them to delete them.");
  });

  it("adds each consent question separately, unticked and optional, with its exact versioned wording", () => {
    const form = full();
    expect(formDefinitionSchema.safeParse(form).success).toBe(true);
    const marketing = form.blocks.find((b) => b.id === AD_CONSENT_IDS.marketing)!;
    expect(marketing).toMatchObject({ type: "checkbox", required: false, label: "I agree that Grace Church may use my details to show me relevant ads and measure them. I can withdraw this at any time." });
    expect(form.ads?.wordings).toEqual({ notice: "ad-notice-v1", newsletter: "ad-newsletter-v1", followUp: "ad-follow-up-v1", marketing: "ad-marketing-v1" });
    // The notice stays last, the consent questions come in a fixed order before it.
    expect(form.blocks.slice(-4).map((b) => b.id)).toEqual([AD_CONSENT_IDS.newsletter, AD_CONSENT_IDS.followUp, AD_CONSENT_IDS.marketing, form.blocks.at(-1)!.id]);
    expect(setAdConsent(full(), "marketing", false, "Grace Church").ads?.wordings.marketing).toBeUndefined();
    expect(hasAdConsent(setAdConsent(full(), "marketing", false, "Grace Church"), "marketing")).toBe(false);
  });

  it("derives the network form and the consent mapping from the definition only", () => {
    const spec = adFormSpec(full())!;
    expect(spec.consentQuestions).toEqual({ newsletter: "consent_newsletter", form_follow_up: "consent_follow_up", marketing: "consent_marketing" });
    expect(spec.consentTexts.marketing).toMatchObject({ key: "consent_marketing", wording: "ad-marketing-v1" });
    expect(spec.questions.map((q) => q.key)).toEqual(["full_name", "email", "phone", "consent_newsletter", "consent_follow_up", "consent_marketing"]);
    expect(spec.notice).toContain("Grace Church");
    expect(Object.values(adConsentPurpose)).toEqual(["newsletter", "form_follow_up", "marketing"]);
    expect(adFormSpec(base())!.consentQuestions).toEqual({});
  });

  it("re-stamps the texts, so a request cannot choose its own consent words", () => {
    const forged: FormDefinition = { ...full(), blocks: full().blocks.map((b) => b.id === AD_CONSENT_IDS.marketing ? { ...b, label: "We may do anything" } : b) };
    const stamped = stampAdsForm(forged, "Grace Church");
    expect(stamped.blocks.find((b) => b.id === AD_CONSENT_IDS.marketing)!.label).toBe(adWordings.marketing["ad-marketing-v1"].replace("{ministry}", "Grace Church"));
    expect(stampAdsForm(stamped, "Grace Church")).toEqual(stamped);
    expect(stampAdsForm(base(), "Other Ministry").ads?.texts.notice).toContain("Other Ministry");
  });

  it("refuses definitions that break the preset", () => {
    const form = full();
    const bad = (change: (f: FormDefinition) => FormDefinition) => expect(formDefinitionSchema.safeParse(change(structuredClone(form))).success).toBe(false);
    bad((f) => ({ ...f, ads: { ...f.ads!, privacyUrl: "http://example.test/p" } }));
    bad((f) => ({ ...f, ads: { ...f.ads!, privacyUrl: "" } }));
    bad((f) => ({ ...f, destination: { type: "people" } }));
    bad((f) => ({ ...f, newsletter: { listIds: [], wordingVersion: "newsletter-consent-v1", consentText: "", fixedNotice: "" } }));
    // A consent question must be an optional checkbox and only exists with its wording.
    bad((f) => ({ ...f, blocks: f.blocks.map((b) => b.id === AD_CONSENT_IDS.marketing ? { ...b, required: true } : b) }));
    bad((f) => ({ ...f, blocks: f.blocks.map((b) => b.id === AD_CONSENT_IDS.marketing ? { ...b, type: "short" } : b) }));
    bad((f) => ({ ...f, ads: { ...f.ads!, wordings: { ...f.ads!.wordings, marketing: undefined } } }));
    bad((f) => ({ ...f, ads: { ...f.ads!, wordings: { ...f.ads!.wordings, marketing: "ad-marketing-v9" as "ad-marketing-v1" } } }));
    // Standard fields map to a block of the right type, once.
    bad((f) => ({ ...f, ads: { ...f.ads!, fields: { ...f.ads!.fields, [f.blocks[0].id]: "email" } } }));
    bad((f) => ({ ...f, ads: { ...f.ads!, fields: { ...f.ads!.fields, [f.blocks[2].id]: "email" } } }));
    bad((f) => ({ ...f, ads: { ...f.ads!, fields: { ...f.ads!.fields, zzzzzzzz: "city" } } }));
    bad((f) => ({ ...f, blocks: f.blocks.map((b, i) => i === 0 ? { ...b, mapTo: "name" } : b) }));
    bad((f) => ({ ...f, blocks: [{ id: "upload01", type: "upload", label: "File", required: false }, ...f.blocks] }));
  });

  it("names what stops a form from being published", () => {
    const form = base();
    const noContact = { ...form, ads: { ...form.ads!, fields: { [form.blocks[0].id]: "full_name" as const } } };
    expect(adFormIssues(noContact)).toEqual(["noContact"]);
    const noName = { ...form, ads: { ...form.ads!, fields: { [form.blocks[1].id]: "email" as const } } };
    expect(adFormIssues(noName)).toEqual(["noName"]);
    const many = { ...form, blocks: [...Array.from({ length: 13 }, (_, i) => ({ id: `qqqqqqq${i.toString(36)}`, type: "short" as const, label: `Q${i}`, required: false })), ...form.blocks] };
    expect(adFormIssues(many)).toContain("tooManyQuestions");
  });

  it("keeps wordings versioned: a published id must keep its exact words (a change is a new id)", () => {
    expect(adWordings).toEqual({
      notice: { "ad-notice-v1": "Your details go to {ministry}. You can ask them to delete them." },
      newsletter: { "ad-newsletter-v1": "I agree to receive the {ministry} newsletter by email. I can unsubscribe at any time." },
      followUp: { "ad-follow-up-v1": "I agree that {ministry} may contact me about my request by email or phone. I can say stop at any time." },
      marketing: { "ad-marketing-v1": "I agree that {ministry} may use my details to show me relevant ads and measure them. I can withdraw this at any time." },
    });
  });
});
