import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { auditLogs, newsletterLists, newsletterSignupForms } from "../db/schema";
import { message } from "../i18n/messages";
import { installNewsletterSuppressionKeys } from "./newsletter-campaigns/suppression-keys";
import { requireNewsletterEnabled } from "./newsletter";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export const newsletterSignupNotice = "newsletter-subject-v1";
const missing = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());
const nonceInput = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signupInput = z.object({ formId: z.uuid(), email: emailInput, notice: z.literal(newsletterSignupNotice), accepted: z.literal(true) }).strict();
const confirmationInput = z.object({ email: emailInput, token: nonceInput }).strict();
const preferenceInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("list"), listId: z.uuid() }).strict(),
  z.object({ scope: z.literal("all") }).strict(),
]);

export function newsletterKey(env = process.env) {
  const raw = env.HARVEST_NEWSLETTER_TOKEN_KEY;
  return raw && /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
}

export function signedDigest(key: Buffer, purpose: string, value: string) {
  return createHmac("sha256", key).update(purpose).update(":").update(value).digest();
}

export function signNewsletterPreference(key: Buffer, scope: "list" | "all", nonce: string) {
  return nonce + "." + signedDigest(key, "newsletter-preference-" + scope, nonce).toString("base64url");
}

export function createNewsletterSignupForm(db: Database, actor: string, workspace: string, raw: unknown) {
  requireNewsletterEnabled();
  const { listId } = z.object({ listId: z.uuid() }).strict().parse(raw);
  return withTenant(db, actor, z.uuid().parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const [list] = await tx.select({ id: newsletterLists.id }).from(newsletterLists)
      .where(and(eq(newsletterLists.tenantId, tenantId), eq(newsletterLists.id, listId)));
    if (!list) throw missing();
    const [form] = await tx.insert(newsletterSignupForms).values({ tenantId, listId, createdBy: actor }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: actor, action: "newsletter.signup_form.create", targetId: form.id, metadata: { listId } });
    return { id: form.id, version: form.version, active: form.active, notice: newsletterSignupNotice };
  });
}

export function updateNewsletterSignupForm(db: Database, actor: string, workspace: string, id: string, raw: unknown) {
  requireNewsletterEnabled();
  const input = z.object({ version: z.number().int().positive().max(2_147_483_646), active: z.boolean() }).strict().parse(raw);
  const formId = z.uuid().parse(id);
  return withTenant(db, actor, z.uuid().parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const [form] = await tx.update(newsletterSignupForms).set({ active: input.active, version: sql`${newsletterSignupForms.version}+1` })
      .where(and(eq(newsletterSignupForms.tenantId, tenantId), eq(newsletterSignupForms.id, formId), eq(newsletterSignupForms.version, input.version))).returning();
    if (!form) throw missing();
    await tx.insert(auditLogs).values({ tenantId, actorId: actor, action: "newsletter.signup_form.update", targetId: form.id,
      metadata: { version: String(form.version), active: String(form.active) } });
    return { id: form.id, version: form.version, active: form.active, notice: newsletterSignupNotice };
  });
}

/** Confirmation material is server-only. The public handler never returns the challenge. */
export async function startNewsletterSignup(db: Database, raw: unknown) {
  requireNewsletterEnabled();
  const input = signupInput.safeParse(raw), key = newsletterKey();
  if (!input.success || !key) return null;
  const { formId, email } = input.data;
  const token = randomBytes(32).toString("base64url");
  const emailKey = signedDigest(key, "newsletter-address-limit", email).toString("hex");
  const { rows: [row] } = await db.execute<{ queued: boolean }>(
    sql`select public.newsletter_signup_start(${formId}::uuid,${email},${token},${emailKey}) as queued`);
  return row.queued ? token : null;
}

export async function confirmNewsletterSignup(db: Database, raw: unknown) {
  requireNewsletterEnabled();
  const input = confirmationInput.safeParse(raw);
  if (!input.success || !newsletterKey()) return;
  await db.transaction(async tx => {
    await installNewsletterSuppressionKeys(tx);
    await tx.execute(sql`select public.newsletter_signup_confirm(${input.data.email},${input.data.token})`);
  });
  // A link from a hosted sign-up form is checked by its own function (the same grant rules, several lists); an unknown token does nothing in either.
  await db.transaction(async tx => {
    await installNewsletterSuppressionKeys(tx);
    await tx.execute(sql`select public.newsletter_form_signup_confirm(${input.data.email},${input.data.token})`);
  });
}

/** Only the owning delivery/service layer should receive this bearer capability. */
export function issueNewsletterPreference(db: Database, actor: string, workspace: string, id: string, raw: unknown) {
  requireNewsletterEnabled();
  const input = preferenceInput.parse(raw), subscriber = z.uuid().parse(id);
  const key = newsletterKey();
  if (!key) throw missing();
  return withTenant(db, actor, z.uuid().parse(workspace), "newsletter:manage", async (tx, tenantId) => {
    const nonce = randomBytes(32).toString("base64url");
    const listId = input.scope === "list" ? input.listId : null;
    const { rows: [row] } = await tx.execute<{ issued: boolean }>(
      sql`select public.newsletter_preference_issue(${tenantId}::uuid,${subscriber}::uuid,${listId}::uuid,${input.scope},${nonce}) as issued`);
    if (!row.issued) throw missing();
    return signNewsletterPreference(key, input.scope, nonce);
  });
}

export async function unsubscribeNewsletter(db: Database, scope: "list" | "all", token: unknown) {
  requireNewsletterEnabled();
  const key = newsletterKey();
  if (!key || typeof token !== "string" || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token)) return;
  const [nonce, signature] = token.split(".");
  const expected = signedDigest(key, "newsletter-preference-" + scope, nonce);
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return;
  await db.transaction(async tx => {
    await installNewsletterSuppressionKeys(tx);
    await tx.execute(sql`select public.newsletter_unsubscribe(${nonce},${scope})`);
  });
}
