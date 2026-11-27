import type { FormBlock, FormDefinition, FormText, NewsletterConfig } from "./crm-forms";

// Newsletter sign-up forms are a preset of the CRM forms builder. This file holds what is specific to the preset: the fixed block ids, the immutable
// consent wordings and the pure helpers the builder, the server and the hosted page share. Nothing here sends or stores anything.

/** Fixed ids of the preset's blocks (the consent block keeps the builder's own fixed id). */
export const NEWSLETTER_BLOCK_IDS = { email: "newsmail", first: "newsfrst", last: "newslast" } as const;

/**
 * Consent wordings are immutable and identified by version: a new wording is a new entry, never an edit, so a person's record can always point at
 * the exact words they agreed to. `{ministry}` is replaced with the ministry's name when the form is saved and again, for the frozen copy, when
 * it is published. The second line is Harvest's fixed minimum line that sits next to the checkbox on every hosted form.
 */
const v1 = {
  consent: "I agree to receive the {ministry} newsletter by email. I can unsubscribe at any time.",
  fixed: "Your details go to {ministry}. You can ask them to delete them.",
} as const;
/** The line a ministry that counts link clicks adds to the consent statement (founder decision, 27 Nov 2026). */
export const CLICKS_COUNTED_LINE = "This ministry counts link clicks in its emails, as totals only.";
export const newsletterWordings = {
  "newsletter-consent-v1": v1,
  // Recorded instead of v1 when the ministry counts link clicks at the moment of sign-up: the v1 statement plus the clicks line, same fixed line.
  "newsletter-consent-v2": { consent: `${v1.consent} ${CLICKS_COUNTED_LINE}`, fixed: v1.fixed },
} as const;
export type NewsletterWordingId = keyof typeof newsletterWordings;
/** Wordings a form is saved and published with. v2 is never stored on a form: it is chosen at sign-up from the ministry's click setting. */
export const newsletterWordingIds = ["newsletter-consent-v1"] as const satisfies readonly NewsletterWordingId[];
export const CURRENT_NEWSLETTER_WORDING: NewsletterWordingId = "newsletter-consent-v1";
/** The wording recorded instead of a form's own when the ministry counts link clicks. Must match newsletter_form_signup_start (migration 0135). */
export const countedWordings: Partial<Record<NewsletterWordingId, NewsletterWordingId>> = { "newsletter-consent-v1": "newsletter-consent-v2" };

/** The wording that applies to a sign-up now: the counted variant of the form's frozen wording while the ministry counts clicks, the frozen one otherwise. */
export function signupWording(frozen: string, clicksCounted: boolean): string {
  return clicksCounted ? countedWordings[frozen as NewsletterWordingId] ?? frozen : frozen;
}

/**
 * The texts a hosted page shows for the wording that applies now. The frozen texts keep the ministry name the form was published with; the counted
 * variant adds only the clicks line, so it is exactly the v2 wording stamped with that same name.
 */
export function signupTexts(config: { wordingVersion: string; consentText: string; fixedNotice: string }, clicksCounted: boolean) {
  const wordingVersion = signupWording(config.wordingVersion, clicksCounted);
  const consentText = wordingVersion === config.wordingVersion ? config.consentText : `${config.consentText} ${CLICKS_COUNTED_LINE}`;
  return { wordingVersion, consentText, fixedNotice: config.fixedNotice };
}

export function newsletterTexts(wording: NewsletterWordingId, ministry: string) {
  const name = ministry.trim() || "the ministry";
  const { consent, fixed } = newsletterWordings[wording];
  return { consentText: consent.replaceAll("{ministry}", name), fixedNotice: fixed.replaceAll("{ministry}", name) };
}

/** Makes the stored texts match the wording version and the ministry name. The consent block's label is the statement, its notice text the statement plus the fixed line. */
export function stampNewsletterForm(form: FormDefinition, ministry: string): FormDefinition {
  if (!form.newsletter) return form;
  const { consentText, fixedNotice } = newsletterTexts(form.newsletter.wordingVersion as NewsletterWordingId, ministry);
  const newsletter: NewsletterConfig = { ...form.newsletter, consentText, fixedNotice };
  const blocks = form.blocks.map((block): FormBlock => block.type === "consent" ? { ...block, label: consentText, text: `${consentText} ${fixedNotice}` } : block);
  return { ...form, newsletter, blocks };
}

/** True when the first and last name questions are on the form. */
export const asksFor = (form: FormDefinition, part: "first" | "last") => form.blocks.some((block) => block.id === NEWSLETTER_BLOCK_IDS[part]);

/** Turns the first or last name question on or off, keeping the email first and the consent last. */
export function setNameQuestion(form: FormDefinition, part: "first" | "last", on: boolean, label: string): FormDefinition {
  const id = NEWSLETTER_BLOCK_IDS[part];
  if (on === asksFor(form, part)) return form;
  if (!on) return { ...form, blocks: form.blocks.filter((block) => block.id !== id) };
  const block: FormBlock = { id, type: "short", label, required: false, mapTo: null };
  const email = form.blocks.findIndex((b) => b.id === NEWSLETTER_BLOCK_IDS.email);
  const first = form.blocks.findIndex((b) => b.id === NEWSLETTER_BLOCK_IDS.first);
  const at = part === "first" ? email + 1 : first >= 0 ? first + 1 : email + 1;
  return { ...form, blocks: [...form.blocks.slice(0, at), block, ...form.blocks.slice(at)] };
}

/** The starting definition of a sign-up form: an email address, optional first and last name, the consent, and the lists chosen. */
export function buildNewsletterForm(text: FormText, listIds: string[], ministry: string, now: string): FormDefinition {
  const wordingVersion = CURRENT_NEWSLETTER_WORDING;
  const { consentText, fixedNotice } = newsletterTexts(wordingVersion, ministry);
  const blocks: FormBlock[] = [
    { id: NEWSLETTER_BLOCK_IDS.email, type: "email", label: text("newsletterForm.email"), required: true, mapTo: "email" },
    { id: NEWSLETTER_BLOCK_IDS.first, type: "short", label: text("newsletterForm.first"), required: false, mapTo: null },
    { id: NEWSLETTER_BLOCK_IDS.last, type: "short", label: text("newsletterForm.last"), required: false, mapTo: null },
    { id: "consent0", type: "consent", label: consentText, required: true, mapTo: null, text: `${consentText} ${fixedNotice}` },
  ];
  return {
    kind: "crm-form-v1", revision: 1, updatedAt: now, title: text("newsletterForm.title"), description: text("newsletterForm.description"), cover: "none", logoUrl: "",
    destination: null, endTitle: text("newsletterForm.endTitle"), endBody: text("newsletterForm.endBody"), blocks,
    settings: { ownerId: null, labels: [], redirectUrl: "", buttonLabel: text("newsletterForm.button"), startLabel: text("defaults.start"), showResubmit: false, spamCheck: true,
      layout: "one", theme: "light", background: "plain", buttonColor: "primary", landing: "build", hiddenCampaign: false, hiddenSource: false },
    newsletter: { listIds, wordingVersion, consentText, fixedNotice },
  };
}

/** The public address and the embed snippet for a published sign-up form. */
export const signupPath = (slug: string) => `/subscribe/${slug}`;
export function embedSnippet(url: string, title: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<iframe src="${escape(url)}?embed=1" title="${escape(title)}" width="100%" height="520" style="border:0;max-width:640px" loading="lazy"></iframe>`;
}
