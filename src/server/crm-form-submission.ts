import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { contactInput, uuidInput } from "../lib/contact-input";
import { formDefinitionSchema, validateBlock, type FormAnswers, type FormBlock, type FormDefinition } from "../lib/crm-forms";
import { NEWSLETTER_BLOCK_IDS, signupWording } from "../lib/newsletter-signup";
import { newsletterFormCountsClicks } from "./newsletter-clicks";
import { crmFormNoticeAcknowledgement } from "./consent-gate";
import { deliverNewsletterConfirmation } from "./newsletter-confirmation";
import { newsletterKey, signedDigest } from "./newsletter-public";

const PROOF_LIFETIME_MS = 600_000;
const MINIMUM_FILL_TIME_MS = 1_000;

type PublishedForm = {
  versionId: string;
  ministryName: string | null;
  definition: FormDefinition;
  notice: { version: number; body: string; hash: string };
};

export type CrmFormCharge = { mode: "peek" } | { mode: "proof" | "submit"; visitor: string };

export async function resolveCrmForm(db: Database, slug: string, charge: CrmFormCharge) {
  const { rows: [row] } = await db.execute<{ result: PublishedForm | { limited: true } | null }>(
    sql`select public.crm_form_public_form(${slug}, ${charge.mode}, ${charge.mode === "peek" ? null : charge.visitor}) as result`);
  if (!row.result || "limited" in row.result) return row.result;
  const definition = formDefinitionSchema.safeParse(row.result.definition);
  return definition.success ? { ...row.result, definition: definition.data } : null;
}

function sign(key: Buffer, slug: string, payload: string) {
  return createHmac("sha256", key).update(`crm-form-presentation:${slug}:${payload}`).digest();
}

export function crmFormManifest(form: PublishedForm, slug: string, key: Buffer, now = Date.now()) {
  const payload = `${form.versionId}.${randomUUID()}.${now}`;
  const { title, description, cover, logoUrl, endTitle, endBody, blocks, settings } = form.definition;
  const { buttonLabel, startLabel, showResubmit, spamCheck, layout, theme, background, buttonColor, hiddenCampaign, hiddenSource, redirectUrl } = settings;
  return {
    title, description, cover, logoUrl, endTitle, endBody, ministryName: form.ministryName, notice: { ...form.notice, purpose: "form_response_processing" },
    blocks: blocks.filter(block => block.type !== "upload").map(({ id, type, label, required, options, text }) => ({ id, type, label, required, options, text })),
    settings: { buttonLabel, startLabel, showResubmit, spamCheck, layout, theme, background, buttonColor, hiddenCampaign, hiddenSource, redirectUrl },
    // The frozen sign-up texts, so the hosted page shows exactly what this publication was approved with. The lists stay on the server.
    ...(form.definition.newsletter ? { newsletter: { wordingVersion: form.definition.newsletter.wordingVersion, consentText: form.definition.newsletter.consentText, fixedNotice: form.definition.newsletter.fixedNotice } } : {}),
    proof: `${payload}.${sign(key, slug, payload).toString("base64url")}`,
  };
}

const valueInput = z.string().max(2000).refine(value => !/\u0000/.test(value));
const submissionInput = z.object({
  proof: z.string().max(160),
  answers: z.record(z.string().regex(/^[a-z0-9]{8}$/), z.union([valueInput, z.array(valueInput).max(20)])),
  campaign: uuidInput.optional(),
  qr: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  website: z.string().max(200).optional(), // Honeypot, separate from the Website answer type.
  wording: z.string().regex(/^newsletter-consent-v\d{1,3}$/).optional(), // Sign-up forms: the consent wording the page showed.
}).strict();

function readProof(proof: string, slug: string, key: Buffer, now: number) {
  const [version, receipt, issued, signature, ...extra] = proof.split(".");
  if (extra.length || !uuidInput.safeParse(version).success || !uuidInput.safeParse(receipt).success
      || !/^\d{13}$/.test(issued ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(signature ?? "")) return null;
  const expected = sign(key, slug, `${version}.${receipt}.${issued}`);
  if (!timingSafeEqual(expected, Buffer.from(signature, "base64url"))) return null;
  const age = now - Number(issued);
  if (age < 0 || age >= PROOF_LIFETIME_MS) return null;
  return { version, receipt, age, expiresAt: new Date(Number(issued) + PROOF_LIFETIME_MS).toISOString() };
}

const scalarLimits: Partial<Record<FormBlock["type"], number>> = {
  short: 200, location: 200, email: 254, website: 300, phone: 30, number: 20, money: 20,
};

function validAnswer(block: FormBlock, value: string | string[] | undefined) {
  if (block.type === "info" || block.type === "upload") return value === undefined;
  if (validateBlock(block, value)) return false;
  if (value === undefined) return true;
  if (block.type === "multi") {
    return Array.isArray(value) && new Set(value).size === value.length && value.every(item => block.options?.includes(item));
  }
  if (typeof value !== "string" || value.length > (scalarLimits[block.type] ?? 2000)) return false;
  if (!value.trim()) return !block.required;
  switch (block.type) {
    case "date": return z.iso.date().safeParse(value).success;
    case "dropdown": case "choice": return block.options?.includes(value) === true;
    case "checkbox": return value === "yes";
    case "vote": return value === "yes" || value === "no";
    case "rating": return /^[1-5]$/.test(value);
    case "signature": return value === "signed";
    default: return true;
  }
}

function mappedAnswers(form: FormDefinition, answers: FormAnswers) {
  const fields = Object.fromEntries(form.blocks.flatMap(block => {
    const value = answers[block.id];
    return block.mapTo && typeof value === "string" ? [[block.mapTo, value.trim()]] : [];
  }));
  const { organization, ...person } = fields;
  const parsed = contactInput.safeParse(person);
  if (!parsed.success || (!parsed.data.email && !parsed.data.phone)) return false;
  if (parsed.data.email && !parsed.data.email.endsWith("@example.test")) return false;
  if (parsed.data.phone && !/^\+120255501\d{2}$/.test(parsed.data.phone)) return false;
  return (organization?.length ?? 0) <= 100 && (form.destination?.type !== "organizations" || Boolean(organization));
}

export async function submitCrmForm(db: Database, form: PublishedForm, slug: string, raw: unknown, key: Buffer, now = Date.now()) {
  const input = submissionInput.parse(raw);
  const proof = readProof(input.proof, slug, key, now);
  if (!proof) return "invalid";
  if (proof.version !== form.versionId) return "not_found";
  const { definition } = form;
  if (input.website || (definition.settings.spamCheck && proof.age < MINIMUM_FILL_TIME_MS)) return "spam";
  const { answers } = input;
  const blocks = new Set(definition.blocks.map(block => block.id));
  if (Object.keys(answers).some(id => !blocks.has(id)) || definition.blocks.some(block => !validAnswer(block, answers[block.id]))) return "invalid";
  if (definition.newsletter) return submitNewsletterSignup(db, form, slug, answers, proof.receipt, input.wording);
  if (!mappedAnswers(definition, answers)) return "invalid";
  const consentBlock = definition.blocks.at(-1);
  const acknowledgement = consentBlock && crmFormNoticeAcknowledgement(consentBlock, answers[consentBlock.id]);
  if (!acknowledgement) return "invalid";

  const sortedAnswers = Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
  const requestHash = createHmac("sha256", key)
    .update(JSON.stringify(["crm-form-response", proof.receipt, sortedAnswers, input.campaign ?? null, input.qr ?? null]))
    .digest("hex");
  const { rows: [row] } = await db.execute<{ result: string }>(sql`
    select public.crm_form_submit(${slug}, ${form.versionId}, ${proof.receipt}, ${proof.expiresAt}::timestamptz,
      ${JSON.stringify(answers)}::jsonb, ${acknowledgement}, ${input.campaign ?? null}, ${input.qr ?? null}, ${requestHash}) as result`);
  return row.result;
}


/**
 * A newsletter sign-up never creates a person or a permission by itself: it records a pending sign-up (digests and optional names only) and sends
 * one confirmation message. Only the confirmation link grants the newsletter permission. A declined, repeated or rate-limited request looks exactly like
 * a successful one, so the form cannot be used to find out who is on a list.
 */
async function submitNewsletterSignup(db: Database, form: PublishedForm, slug: string, answers: FormAnswers, receipt: string, shown: string | undefined) {
  const tokenKey = newsletterKey();
  if (!tokenKey) return "not_found";
  // The recorded wording is the one that applies at sign-up (v2 while the ministry counts link clicks). A page that showed another wording, because the
  // owner changed the setting after it loaded, is asked to reload so the person sees the words that will be recorded. The database checks again.
  const frozen = form.definition.newsletter!.wordingVersion, wording = shown ?? frozen;
  if (wording !== signupWording(frozen, await newsletterFormCountsClicks(db, slug))) return "conflict";
  const email = String(answers[NEWSLETTER_BLOCK_IDS.email] ?? "").trim().toLowerCase();
  // Synthetic data only, like every hosted form while the activation decisions are open.
  if (!z.email().max(254).safeParse(email).success || !email.endsWith("@example.test")) return "invalid";
  const name = (id: string) => String(answers[id] ?? "").trim();
  const [first, last] = [name(NEWSLETTER_BLOCK_IDS.first), name(NEWSLETTER_BLOCK_IDS.last)];
  const token = randomBytes(32).toString("base64url");
  const addressKey = signedDigest(tokenKey, "newsletter-address-limit", email).toString("hex");
  const { rows: [row] } = await db.execute<{ queued: boolean }>(sql`
    select public.newsletter_form_signup_start(${slug}, ${form.versionId}::uuid, ${receipt}::uuid, ${email}, ${first}, ${last}, ${token}, ${addressKey}, ${wording}) as queued`);
  if (row.queued) deliverNewsletterConfirmation({ to: email, token, ministryName: form.ministryName, formTitle: form.definition.title });
  return "ok";
}
