import { CONSENT_ID, defaultSettings, FORM_KIND, newBlockId, type FormBlock, type FormDefinition, type FormText } from "../crm-forms";
import { AD_CONSENT_IDS, adConsentKinds, adWordingText, CURRENT_AD_WORDING, stampAdsForm, type AdConsentKind, type AdFieldKey, type AdNetworkId } from "./lead-form";

/** Standard answers a builder can add, with the question type each needs. */
export const adStandardBlock: Record<AdFieldKey, "short" | "email" | "phone"> = {
  full_name: "short", first_name: "short", last_name: "short", email: "email", phone: "phone", city: "short", zip: "short", country: "short",
};

/** The starting definition of an ad lead form: name, email and phone, the notice and the privacy link. No consent question is on it until the owner adds one. */
export function buildAdLeadForm(text: FormText, network: AdNetworkId, privacyUrl: string, ministry: string, now: string): FormDefinition {
  const ids = { name: newBlockId(), email: newBlockId(), phone: newBlockId() };
  const notice = adWordingText("notice", CURRENT_AD_WORDING.notice, ministry)!;
  const blocks: FormBlock[] = [
    { id: ids.name, type: "short", label: text("adForm.name"), required: true, mapTo: null },
    { id: ids.email, type: "email", label: text("adForm.email"), required: true, mapTo: null },
    { id: ids.phone, type: "phone", label: text("adForm.phone"), required: false, mapTo: null },
    { id: CONSENT_ID, type: "consent", label: notice, required: true, mapTo: null, text: notice },
  ];
  return stampAdsForm({
    kind: FORM_KIND, revision: 1, updatedAt: now, title: text("adForm.title"), description: "", cover: "none", logoUrl: "", destination: null,
    endTitle: text("adForm.endTitle"), endBody: text("adForm.endBody"), blocks,
    settings: { ...defaultSettings(), buttonLabel: text("adForm.button"), startLabel: text("defaults.start") },
    ads: { network, privacyUrl, fields: { [ids.name]: "full_name", [ids.email]: "email", [ids.phone]: "phone" },
      wordings: { notice: CURRENT_AD_WORDING.notice }, texts: { notice } },
  }, ministry);
}

/** True when the optional consent question is on the form. */
export const hasAdConsent = (form: FormDefinition, kind: AdConsentKind) => form.blocks.some((b) => b.id === AD_CONSENT_IDS[kind]);

/** Turns one optional consent question on (with the current wording) or off. The questions stay in a fixed order just before the notice, each its own unticked checkbox. */
export function setAdConsent(form: FormDefinition, kind: AdConsentKind, on: boolean, ministry: string): FormDefinition {
  if (!form.ads || on === hasAdConsent(form, kind)) return form;
  const { [kind]: removed, ...wordings } = form.ads.wordings as Record<string, string | undefined>;
  void removed;
  if (!on) {
    const { [kind]: gone, ...texts } = form.ads.texts as Record<string, string | undefined>;
    void gone;
    return { ...form, blocks: form.blocks.filter((b) => b.id !== AD_CONSENT_IDS[kind]), ads: { ...form.ads, wordings: wordings as typeof form.ads.wordings, texts: texts as typeof form.ads.texts } };
  }
  const wording = CURRENT_AD_WORDING[kind];
  const statement = adWordingText(kind, wording, ministry)!;
  const block: FormBlock = { id: AD_CONSENT_IDS[kind], type: "checkbox", label: statement, required: false, mapTo: null };
  const last = form.blocks.length - 1; // the notice is always last
  const before = adConsentKinds.filter((k) => adConsentKinds.indexOf(k) < adConsentKinds.indexOf(kind) && hasAdConsent(form, k)).length;
  const firstConsent = form.blocks.findIndex((b) => adConsentKinds.some((k) => AD_CONSENT_IDS[k] === b.id));
  const at = firstConsent >= 0 ? firstConsent + before : last;
  return stampAdsForm({ ...form, blocks: [...form.blocks.slice(0, at), block, ...form.blocks.slice(at)],
    ads: { ...form.ads, wordings: { ...form.ads.wordings, [kind]: wording }, texts: { ...form.ads.texts, [kind]: statement } } }, ministry);
}
