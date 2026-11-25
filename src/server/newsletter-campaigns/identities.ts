import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { newsletterConnections, newsletterIdentities } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { audit, conflict, digest, id, pageInput, unavailable, version, withNewsletter } from "./access";
import { FakeNewsletterProvider } from "./fake-provider";
import type { DomainRecord } from "./port";

const createInput = z.object({ address: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  purpose: z.enum(["sender", "reply-to"]).default("sender") }).strict();
// A display name is plain text for the From line: no angle brackets, quotes, at signs or control characters (no header tricks, no look-alike addresses).
export const displayNameInput = z.string().trim().max(80).regex(/^[^<>"@\p{Cc}]*$/u).transform(value => value || null).nullable();
const deleteInput = z.object({ version }).strict();
const editInput = z.union([
  z.object({ version, enabled: z.boolean() }).strict(),
  z.object({ version, displayName: displayNameInput }).strict(),
  z.object({ version, action: z.literal("confirm"), code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
  z.object({ version, action: z.literal("request-code") }).strict(),
]);
const confirmationMs = 30 * 60_000;
const domainMaxAgeMs = 48 * 60 * 60_000;
export const emailDomain = (address: string) => address.slice(address.lastIndexOf("@") + 1);

export function domainVerified(domain: typeof newsletterConnections.$inferSelect) {
  return Boolean(domain.checkedAt && domain.checkedAt.getTime() > Date.now() - domainMaxAgeMs &&
    domain.ownership && domain.spf && domain.dkim && domain.bounce && domain.dmarc);
}

function identityResponse(row: typeof newsletterIdentities.$inferSelect, domain: typeof newsletterConnections.$inferSelect | null) {
  const { confirmationDigest, ...identity } = row;
  return { identity: { ...identity, confirmationPending: Boolean(confirmationDigest) },
    domain: domain && { ...domain, status: domainVerified(domain) ? "verified" : domain.checkedAt ? "unverified" : "pending" } };
}

export function dnsInstructions(domain: string, code: string): DomainRecord[] {
  const bounce = "bounce." + domain;
  const selector = code.slice(0, 16).toLowerCase().replaceAll("_", "x").replaceAll("-", "x");
  // Synthetic targets. The live registrar would supply the provider-assigned DKIM and MAIL FROM values.
  return [
    { purpose: "ownership", type: "TXT", name: "_harvest-newsletter." + domain, value: "harvest-verification=" + code },
    { purpose: "dkim", type: "CNAME", name: selector + "._domainkey." + domain, value: selector + ".dkim.example.test" },
    { purpose: "spf", type: "TXT", name: bounce, value: "v=spf1 include:mail.example.test -all" },
    { purpose: "bounce", type: "MX", name: bounce, value: "10 feedback.example.test" },
    { purpose: "dmarc", type: "TXT", name: "_dmarc." + domain, value: "v=DMARC1; p=none" },
  ];
}

function challenge(address: string) {
  const code = randomBytes(32).toString("base64url");
  return {
    proof: { confirmationDigest: digest(code), confirmationExpiresAt: new Date(Date.now() + confirmationMs) },
    mail: { to: address, subject: message("NewsletterEmail.confirmMailboxSubject"),
      text: message("NewsletterEmail.confirmMailboxText", { code }) },
  };
}

export async function identity(tx: Transaction, tenant: string, identityId: string) {
  const [row] = await tx.select().from(newsletterIdentities)
    .where(and(eq(newsletterIdentities.tenantId, tenant), eq(newsletterIdentities.id, id(identityId)))).for("share");
  if (!row) throw unavailable();
  const [domain] = row.connectionId ? await tx.select().from(newsletterConnections)
    .where(and(eq(newsletterConnections.tenantId, tenant), eq(newsletterConnections.id, row.connectionId))) : [];
  return { identity: row, domain: domain ?? null };
}

export function assertVerified(row: Awaited<ReturnType<typeof identity>>, sender: boolean) {
  const { identity, domain } = row;
  if (!identity.enabled || !identity.ownershipVerified || identity.purpose !== (sender ? "sender" : "reply-to") ||
      (sender && (!domain || domain.domain !== emailDomain(identity.address) || !domainVerified(domain)))) {
    throw conflict("IDENTITY_UNVERIFIED");
  }
}

export function listIdentities(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const page = pageInput.parse(raw);
    const rows = await tx.select({ identity: newsletterIdentities, domain: newsletterConnections }).from(newsletterIdentities)
      .leftJoin(newsletterConnections, and(eq(newsletterConnections.tenantId, tenant),
        eq(newsletterConnections.id, newsletterIdentities.connectionId)))
      .where(and(eq(newsletterIdentities.tenantId, tenant), page.after ? gt(newsletterIdentities.id, page.after) : undefined))
      .orderBy(asc(newsletterIdentities.id)).limit(page.limit + 1);
    return { items: rows.slice(0, page.limit).map(row => identityResponse(row.identity, row.domain)),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].identity.id : null, providerAvailability: "unavailable" };
  });
}

export async function createIdentity(db: Database, actor: string, workspace: string, raw: unknown,
  sink: Pick<FakeNewsletterProvider, "confirmMailbox"> = new FakeNewsletterProvider()) {
  const created = await withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const { address, purpose } = createInput.parse(raw);
    const domain = emailDomain(address);
    let connection: typeof newsletterConnections.$inferSelect | null = null;
    if (purpose === "sender") {
      const records = dnsInstructions(domain, randomBytes(24).toString("base64url"));
      await tx.execute(sql`insert into public.newsletter_connections (tenant_id,domain,records)
        values (${tenant}::uuid,${domain},${JSON.stringify(records)}::jsonb) on conflict (tenant_id,domain) do nothing`);
      [connection] = await tx.select().from(newsletterConnections).where(and(eq(newsletterConnections.tenantId, tenant),
        eq(newsletterConnections.domain, domain)));
    }
    const { proof, mail } = challenge(address);
    const { rows: [created] } = await tx.execute<{ id: string }>(sql`
      insert into public.newsletter_identities (tenant_id,address,purpose,connection_id,confirmation_digest,confirmation_expires_at)
      values (${tenant}::uuid,${address},${purpose},${connection?.id ?? null}::uuid,${proof.confirmationDigest},${proof.confirmationExpiresAt.toISOString()}::timestamptz)
      on conflict (tenant_id,address,purpose) do nothing returning id`);
    if (!created) throw conflict("IDENTITY_EXISTS");
    const { identity: row } = await identity(tx, tenant, created.id);
    await audit(tx, tenant, actor, "newsletter.identity.create", row.id, row.version);
    return { result: identityResponse(row, connection), mail };
  });
  await sink.confirmMailbox(created.mail);
  return created.result;
}

export async function updateIdentity(db: Database, actor: string, workspace: string, identityId: string, raw: unknown,
  sink: Pick<FakeNewsletterProvider, "confirmMailbox"> = new FakeNewsletterProvider()) {
  const updated = await withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const input = editInput.parse(raw);
    const filter = and(eq(newsletterIdentities.tenantId, tenant), eq(newsletterIdentities.id, id(identityId)));
    const [current] = await tx.select().from(newsletterIdentities).where(filter).for("update");
    if (!current) throw unavailable();
    if (current.version !== input.version) throw conflict("STALE_VERSION");
    let changes: Partial<typeof newsletterIdentities.$inferInsert>;
    let mail: ReturnType<typeof challenge>["mail"] | undefined;
    if ("enabled" in input) changes = { enabled: input.enabled };
    else if ("displayName" in input) {
      if (current.purpose !== "sender") throw conflict("DISPLAY_NAME_SENDER_ONLY");
      changes = { displayName: input.displayName };
    }
    else if (input.action === "confirm") {
      if (!current.confirmationExpiresAt || current.confirmationExpiresAt.getTime() <= Date.now() ||
          digest(input.code) !== current.confirmationDigest) throw conflict("MAILBOX_CONFIRMATION_INVALID");
      await tx.execute(sql`select public.newsletter_confirm_mailbox(${tenant}::uuid,${current.id}::uuid,${digest(input.code)})`);
      const confirmed = await identity(tx, tenant, current.id);
      await audit(tx, tenant, actor, "newsletter.identity.confirm", confirmed.identity.id, confirmed.identity.version);
      return { result: identityResponse(confirmed.identity, confirmed.domain), mail };
    } else {
      if (current.ownershipVerified) throw conflict("MAILBOX_ALREADY_VERIFIED");
      const pending = challenge(current.address);
      changes = pending.proof;
      mail = pending.mail;
    }
    const [row] = await tx.update(newsletterIdentities).set({ ...changes, version: input.version + 1 })
      .where(filter).returning();
    await audit(tx, tenant, actor, "newsletter.identity.update", row.id, row.version);
    const { domain } = await identity(tx, tenant, row.id);
    return { result: identityResponse(row, domain), mail };
  });
  if (updated.mail) await sink.confirmMailbox(updated.mail);
  return updated.result;
}

/** Deletes a sender or reply-to address for real. Refused while any revision of any campaign names it, and when the version is stale. */
export function deleteIdentity(db: Database, actor: string, workspace: string, identityId: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const { version: expected } = deleteInput.parse(raw);
    const { rows: [result] } = await tx.execute<{ outcome: string }>(sql`select public.newsletter_delete_identity(${tenant}::uuid,${id(identityId)}::uuid,${expected}::integer) as outcome`);
    if (result?.outcome === "missing") throw unavailable();
    if (result?.outcome === "stale") throw conflict("STALE_VERSION");
    if (result?.outcome === "in_use") throw new AccessError(409, message("Errors.senderInUse"), { code: "IDENTITY_IN_USE" });
    await audit(tx, tenant, actor, "newsletter.identity.delete", identityId, expected);
    return { deleted: true as const };
  });
}
