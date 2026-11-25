import type { FormBlock, FormDefinition } from "../crm-forms";
import type { adNetworks } from "./ads";

// Ad lead forms are a preset of the shared CRM forms model (the same definition, blocks and validation as hosted forms and sign-up forms). This file holds what is specific to the
// preset: the fixed block ids of the optional consent questions, the immutable consent wordings and the pure helpers the builder, the server and the schema share. Nothing here
// sends or stores anything.

export type AdNetworkId = typeof adNetworks[number];
/** Standard answers a network understands; every other question is a custom question. */
export const adFieldKeys = ["full_name", "first_name", "last_name", "email", "phone", "city", "zip", "country"] as const;
export type AdFieldKey = typeof adFieldKeys[number];
/** Block types a network instant form can ask. */
export const adBlockTypes = ["short", "long", "email", "phone", "number", "dropdown", "choice"] as const;
export const AD_MAX_QUESTIONS = 14;

/** Fixed ids of the three optional consent questions (the required notice keeps the builder's own consent block). Each is its own unticked checkbox: never bundled. */
export const AD_CONSENT_IDS = { newsletter: "adnewsl0", followUp: "adfollow", marketing: "admarket" } as const;
export type AdConsentKind = keyof typeof AD_CONSENT_IDS;
export const adConsentKinds = ["newsletter", "followUp", "marketing"] as const satisfies readonly AdConsentKind[];
/** The consent ledger purpose each question grants, and the answer key a network reports for it. */
export const adConsentPurpose = { newsletter: "newsletter", followUp: "form_follow_up", marketing: "marketing" } as const;
export const adConsentKey = { newsletter: "consent_newsletter", followUp: "consent_follow_up", marketing: "consent_marketing" } as const;

/**
 * Wordings are immutable and identified by version: a new wording is a new entry, never an edit, so a person's record can always point at the exact words they were shown.
 * `{ministry}` is replaced with the ministry's name when the form is saved. DRAFT WORDING: founder approval required before any real use (see docs/acceptance/ads-server.md).
 */
export const adWordings = {
  notice: { "ad-notice-v1": "Your details go to {ministry}. You can ask them to delete them." },
  newsletter: { "ad-newsletter-v1": "I agree to receive the {ministry} newsletter by email. I can unsubscribe at any time." },
  followUp: { "ad-follow-up-v1": "I agree that {ministry} may contact me about my request by email or phone. I can say stop at any time." },
  marketing: { "ad-marketing-v1": "I agree that {ministry} may use my details to show me relevant ads and measure them. I can withdraw this at any time." },
} as const;
export type AdWordingKind = keyof typeof adWordings;
export const adWordingIds = {
  notice: ["ad-notice-v1"], newsletter: ["ad-newsletter-v1"], followUp: ["ad-follow-up-v1"], marketing: ["ad-marketing-v1"],
} as const satisfies Record<AdWordingKind, readonly string[]>;
export const CURRENT_AD_WORDING = { notice: "ad-notice-v1", newsletter: "ad-newsletter-v1", followUp: "ad-follow-up-v1", marketing: "ad-marketing-v1" } as const;

export type AdsFormConfig = {
  network: AdNetworkId; privacyUrl: string;
  /** Block id -> the standard answer it collects. A block that is not listed is a custom question. */
  fields: Record<string, AdFieldKey>;
  wordings: { notice: string; newsletter?: string; followUp?: string; marketing?: string };
  /** The exact stored texts for the wordings above, for the ministry the form was saved for. */
  texts: { notice: string; newsletter?: string; followUp?: string; marketing?: string };
};

export function adWordingText(kind: AdWordingKind, wording: string, ministry: string): string | null {
  const table = adWordings[kind] as Record<string, string>;
  const template = table[wording];
  return template === undefined ? null : template.replaceAll("{ministry}", ministry.trim() || "the ministry");
}

/** Makes the stored texts match the wording versions and the ministry name. The notice block holds the notice, each consent block its own statement. */
export function stampAdsForm(form: FormDefinition, ministry: string): FormDefinition {
  const ads = form.ads;
  if (!ads) return form;
  const texts: AdsFormConfig["texts"] = { notice: adWordingText("notice", ads.wordings.notice, ministry) ?? ads.texts.notice };
  for (const kind of adConsentKinds) {
    const wording = ads.wordings[kind];
    if (wording) texts[kind] = adWordingText(kind, wording, ministry) ?? ads.texts[kind];
  }
  const blocks = form.blocks.map((block): FormBlock => {
    if (block.type === "consent") return { ...block, label: texts.notice, text: texts.notice };
    const kind = adConsentKinds.find((k) => AD_CONSENT_IDS[k] === block.id);
    return kind && texts[kind] ? { ...block, label: texts[kind]! } : block;
  });
  return { ...form, ads: { ...ads, texts }, blocks };
}

/** The answer key a network reports for a block of this form. */
export function adQuestionKey(form: FormDefinition, block: FormBlock): string {
  const kind = adConsentKinds.find((k) => AD_CONSENT_IDS[k] === block.id);
  if (kind) return adConsentKey[kind];
  return form.ads?.fields[block.id] ?? `custom_${block.id}`;
}

export type AdFormSpec = {
  /** The notice shown beside the privacy link; kept as the evidence of every lead from this form. */
  notice: string; privacyUrl: string; network: AdNetworkId;
  questions: { key: string; label: string; type: string; required: boolean; options?: string[] }[];
  /** purpose -> question key, only for consent questions the form actually asks. */
  consentQuestions: Record<string, string>;
  /** purpose -> the answer key, the wording id and the exact text shown. */
  consentTexts: Record<string, { key: string; wording: string; text: string }>;
};

/** What the network form is created from and what the lead-form row records. Derived from the frozen definition only, never from request input. */
export function adFormSpec(form: FormDefinition): AdFormSpec | null {
  const ads = form.ads;
  if (!ads) return null;
  const questions: AdFormSpec["questions"] = [];
  const consentQuestions: AdFormSpec["consentQuestions"] = {}, consentTexts: AdFormSpec["consentTexts"] = {};
  for (const block of form.blocks) {
    if (block.type === "consent" || block.type === "info") continue;
    const kind = adConsentKinds.find((k) => AD_CONSENT_IDS[k] === block.id);
    const key = adQuestionKey(form, block);
    if (kind) {
      const wording = ads.wordings[kind];
      if (!wording) continue;
      consentQuestions[adConsentPurpose[kind]] = key;
      consentTexts[adConsentPurpose[kind]] = { key, wording, text: ads.texts[kind] ?? block.label };
      questions.push({ key, label: block.label, type: "consent", required: false });
    } else questions.push({ key, label: block.label, type: block.type, required: block.required, ...(block.options ? { options: block.options } : {}) });
  }
  return { notice: ads.texts.notice, privacyUrl: ads.privacyUrl, network: ads.network, questions, consentQuestions, consentTexts };
}

export type AdFormIssue = "noName" | "noContact" | "noPrivacy" | "emptyChoice" | "tooManyQuestions";
/** What stops an ad lead form from being published: a person's name, a way to reach them and the privacy policy link. */
export function adFormIssues(form: FormDefinition): AdFormIssue[] {
  const ads = form.ads;
  if (!ads) return ["noName", "noContact", "noPrivacy"];
  const mapped = new Set(Object.values(ads.fields));
  const issues: AdFormIssue[] = [];
  if (!mapped.has("full_name") && !mapped.has("first_name")) issues.push("noName");
  if (!mapped.has("email") && !mapped.has("phone")) issues.push("noContact");
  if (!ads.privacyUrl) issues.push("noPrivacy");
  if (form.blocks.some((b) => b.options?.some((o) => !o.trim()))) issues.push("emptyChoice");
  if (form.blocks.filter((b) => b.type !== "consent" && b.type !== "info").length > AD_MAX_QUESTIONS) issues.push("tooManyQuestions");
  return issues;
}
