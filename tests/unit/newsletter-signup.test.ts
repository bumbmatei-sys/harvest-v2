import { describe, expect, it } from "vitest";
import { formDefinitionSchema, formIssues, moveBlock, removeBlock } from "../../src/lib/crm-forms";
import { asksFor, buildNewsletterForm, embedSnippet, newsletterTexts, newsletterWordings, NEWSLETTER_BLOCK_IDS, setNameQuestion, signupPath, stampNewsletterForm } from "../../src/lib/newsletter-signup";

const text = (key: string) => key;
const list = "11111111-1111-4111-8111-111111111111", list2 = "22222222-2222-4222-8222-222222222222";
const build = (lists = [list]) => buildNewsletterForm(text, lists, "Grace Church", "2026-11-24T00:00:00.000Z");

describe("newsletter sign-up preset", () => {
  it("builds a valid definition: email, optional names, the consent last, no CRM destination", () => {
    const form = build([list, list2]);
    expect(formDefinitionSchema.safeParse(form).success).toBe(true);
    expect(form.blocks.map((block) => block.id)).toEqual([NEWSLETTER_BLOCK_IDS.email, NEWSLETTER_BLOCK_IDS.first, NEWSLETTER_BLOCK_IDS.last, "consent0"]);
    expect(form.blocks[0]).toMatchObject({ type: "email", required: true, mapTo: "email" });
    expect(form.blocks.slice(1, 3).every((block) => !block.required && block.mapTo === null)).toBe(true);
    expect(form.destination).toBeNull();
    expect(formIssues(form)).toEqual([]);
  });

  it("freezes an immutable wording: the id, the statement and the fixed line", () => {
    const form = build();
    expect(form.newsletter).toMatchObject({ wordingVersion: "newsletter-consent-v1", consentText: "I agree to receive the Grace Church newsletter by email. I can unsubscribe at any time.",
      fixedNotice: "Your details go to Grace Church. You can ask them to delete them." });
    expect(form.blocks.at(-1)).toMatchObject({ type: "consent", required: true, label: form.newsletter!.consentText, text: `${form.newsletter!.consentText} ${form.newsletter!.fixedNotice}` });
    // Existing versions are never edited: this pins the shipped wording so a change has to be a new version id.
    expect(newsletterWordings["newsletter-consent-v1"]).toEqual({
      consent: "I agree to receive the {ministry} newsletter by email. I can unsubscribe at any time.", fixed: "Your details go to {ministry}. You can ask them to delete them." });
    expect(newsletterTexts("newsletter-consent-v1", "  ")).toMatchObject({ fixedNotice: "Your details go to the ministry. You can ask them to delete them." });
  });

  it("restamps edited texts from the wording version and the ministry name", () => {
    const form = build();
    const tampered = { ...form, newsletter: { ...form.newsletter!, consentText: "x", fixedNotice: "y" }, blocks: form.blocks.map((b) => b.type === "consent" ? { ...b, label: "x", text: "z" } : b) };
    expect(stampNewsletterForm(tampered, "Grace Church")).toEqual(form);
    expect(stampNewsletterForm(form, "New Name").newsletter!.fixedNotice).toContain("New Name");
  });

  it("needs a list to be ready, and a draft may have none", () => {
    expect(formIssues(build([]))).toEqual(["noLists"]);
    expect(formDefinitionSchema.safeParse(build([])).success).toBe(true);
  });

  it("rejects shapes the preset does not allow", () => {
    const form = build();
    const bad = (change: (copy: typeof form) => void) => { const copy = structuredClone(form); change(copy); return formDefinitionSchema.safeParse(copy).success; };
    expect(bad(() => {})).toBe(true);
    expect(bad((c) => { c.destination = { type: "people" }; })).toBe(false);
    expect(bad((c) => { c.blocks = c.blocks.filter((b) => b.id !== NEWSLETTER_BLOCK_IDS.email); })).toBe(false);
    expect(bad((c) => { c.blocks[0].required = false; })).toBe(false);
    expect(bad((c) => { c.blocks.splice(1, 0, { id: "extra001", type: "short", label: "Extra", required: false, mapTo: null }); })).toBe(false);
    expect(bad((c) => { c.blocks[1].mapTo = "name"; })).toBe(false);
    expect(bad((c) => { c.newsletter!.wordingVersion = "newsletter-consent-v2"; })).toBe(false);
    expect(bad((c) => { c.newsletter!.listIds = [list, list]; })).toBe(false);
    expect(bad((c) => { c.newsletter!.listIds = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`); })).toBe(false);
    expect(bad((c) => { c.blocks.at(-1)!.required = false; })).toBe(false);
  });

  it("turns the name questions on and off in place, keeping the email first and the consent last", () => {
    let form = build();
    expect(asksFor(form, "first") && asksFor(form, "last")).toBe(true);
    form = setNameQuestion(form, "first", false, "First name");
    form = setNameQuestion(form, "last", false, "Last name");
    expect(form.blocks.map((b) => b.id)).toEqual([NEWSLETTER_BLOCK_IDS.email, "consent0"]);
    form = setNameQuestion(form, "last", true, "Last name");
    form = setNameQuestion(form, "first", true, "First name");
    expect(form.blocks.map((b) => b.id)).toEqual([NEWSLETTER_BLOCK_IDS.email, NEWSLETTER_BLOCK_IDS.first, NEWSLETTER_BLOCK_IDS.last, "consent0"]);
    expect(setNameQuestion(form, "first", true, "First name")).toBe(form);
    expect(formDefinitionSchema.safeParse(form).success).toBe(true);
  });

  it("keeps the consent block pinned and mandatory in the shared helpers", () => {
    const form = build();
    expect(removeBlock(form.blocks, "consent0")).toHaveLength(form.blocks.length);
    expect(moveBlock(form.blocks, 0, 3)).toBe(form.blocks);
  });

  it("builds the public path and an escaped embed snippet", () => {
    expect(signupPath("grace-news")).toBe("/subscribe/grace-news");
    const snippet = embedSnippet("https://harvest.test/subscribe/grace-news", 'Join "us" <now>');
    expect(snippet).toBe('<iframe src="https://harvest.test/subscribe/grace-news?embed=1" title="Join &#34;us&#34; &#60;now&#62;" width="100%" height="520" style="border:0;max-width:640px" loading="lazy"></iframe>');
    expect(snippet).not.toContain("<now>");
  });
});
