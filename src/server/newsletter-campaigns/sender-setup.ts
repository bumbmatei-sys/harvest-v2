import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { newsletterBrandKits, newsletterConnections, newsletterIdentities } from "../../db/schema";
import { defaultBrand, isEmailDocument } from "../../lib/email/blocks";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { audit, conflict, id, unavailable, version, withNewsletter } from "./access";
import { FakeNewsletterProvider } from "./fake-provider";
import { dnsInstructions, domainVerified, emailDomain } from "./identities";

type Connection = typeof newsletterConnections.$inferSelect;
type Identity = typeof newsletterIdentities.$inferSelect;

const domainInput = z.object({ domain: z.string().trim().toLowerCase().max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/) }).strict();
const addressInput = z.object({ address: z.string().trim().max(300), version: version.optional() }).strict();

export type DomainStatus = "pending" | "verified" | "failed";

/** A domain is verified only while the provider's last answer is complete and fresh; never assumed. */
export function domainStatus(domain: Connection): DomainStatus {
  return domainVerified(domain) ? "verified" : domain.checkedAt ? "failed" : "pending";
}

export function domainResponse(domain: Connection) {
  return { id: domain.id, domain: domain.domain, records: domain.records, version: domain.version,
    checks: { ownership: domain.ownership, spf: domain.spf, dkim: domain.dkim, bounce: domain.bounce, dmarc: domain.dmarc },
    checkedAt: domain.checkedAt, status: domainStatus(domain) };
}

export type IdentityStatus = "unverified" | "pending" | "verified" | "failed";

/** Sender: mailbox confirmed and its domain verified. Reply-to: mailbox confirmed. */
export function identityStatus(identity: Identity, domain: Connection | null): IdentityStatus {
  if (!identity.ownershipVerified) return identity.confirmationDigest ? "pending" : "unverified";
  if (identity.purpose !== "sender") return "verified";
  return domain && domainVerified(domain) ? "verified" : domain?.checkedAt ? "failed" : "pending";
}

export async function mailingAddress(tx: Transaction, tenant: string) {
  const [row] = await tx.select().from(newsletterBrandKits).where(eq(newsletterBrandKits.tenantId, tenant));
  return { address: (row?.kit.address ?? defaultBrand.address).trim(), version: row?.version ?? 0 };
}

export async function readiness(tx: Transaction, tenant: string) {
  const domains = await tx.select().from(newsletterConnections).where(eq(newsletterConnections.tenantId, tenant));
  const identities = await tx.select().from(newsletterIdentities).where(and(eq(newsletterIdentities.tenantId, tenant), eq(newsletterIdentities.enabled, true)));
  const byId = new Map(domains.map(domain => [domain.id, domain]));
  const verifiedSender = identities.some(row => row.purpose === "sender" && row.ownershipVerified && row.connectionId &&
    domainVerified(byId.get(row.connectionId)!));
  const items = {
    domain: domains.some(domainVerified),
    sender: verifiedSender,
    replyTo: identities.some(row => row.purpose === "reply-to" && row.ownershipVerified),
    mailingAddress: Boolean((await mailingAddress(tx, tenant)).address),
    // The renderer appends the unsubscribe link to every message; it cannot be missing.
    unsubscribe: true,
  };
  return { ...items, ready: Object.values(items).every(Boolean) };
}

/** Review and send refuse a message that would print "Mailing address not set". */
export async function assertMailingAddress(tx: Transaction, tenant: string, content: unknown) {
  const own = isEmailDocument(content) ? content.brand.address.trim() : "";
  if (own || (!isEmailDocument(content) && (await mailingAddress(tx, tenant)).address)) return;
  throw new AccessError(409, message("Errors.mailingAddressRequired"), { code: "MAILING_ADDRESS_REQUIRED" });
}

export function senderSetup(db: Database, actor: string, workspace: string) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const domains = await tx.select().from(newsletterConnections).where(eq(newsletterConnections.tenantId, tenant)).orderBy(asc(newsletterConnections.domain));
    const identities = await tx.select().from(newsletterIdentities).where(eq(newsletterIdentities.tenantId, tenant)).orderBy(asc(newsletterIdentities.address));
    const byId = new Map(domains.map(domain => [domain.id, domain]));
    return {
      identities: identities.map(row => {
        const { confirmationDigest, ...visible } = row, domain = row.connectionId ? byId.get(row.connectionId) ?? null : null;
        return { ...visible, confirmationPending: Boolean(confirmationDigest), domain: domain?.domain ?? null,
          status: identityStatus(row, domain) };
      }),
      domains: domains.map(domainResponse),
      mailingAddress: await mailingAddress(tx, tenant),
      readiness: await readiness(tx, tenant),
      sending: "off" as const,
    };
  });
}

export function addDomain(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const { domain } = domainInput.parse(raw);
    const records = dnsInstructions(domain, randomBytes(24).toString("base64url"));
    const { rows: [created] } = await tx.execute<{ id: string }>(sql`insert into public.newsletter_connections (tenant_id,domain,records)
      values (${tenant}::uuid,${domain},${JSON.stringify(records)}::jsonb) on conflict (tenant_id,domain) do nothing returning id`);
    if (!created) throw conflict("DOMAIN_EXISTS");
    await audit(tx, tenant, actor, "newsletter.domain.create", created.id, 1);
    const [row] = await tx.select().from(newsletterConnections).where(and(eq(newsletterConnections.tenantId, tenant), eq(newsletterConnections.id, created.id)));
    return domainResponse(row);
  });
}

/** Asks the provider port (the synthetic one) outside any transaction, then records its answer. Never marks a domain verified on its own. */
export async function verifyDomain(db: Database, actor: string, workspace: string, domainId: string,
  provider: Pick<FakeNewsletterProvider, "domain"> = new FakeNewsletterProvider()) {
  const current = await withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const [row] = await tx.select().from(newsletterConnections).where(and(eq(newsletterConnections.tenantId, tenant), eq(newsletterConnections.id, id(domainId))));
    if (!row) throw unavailable();
    return row;
  });
  const status = await provider.domain(current.domain, current.records);
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const { rows: [result] } = await tx.execute<{ checked: boolean }>(sql`select public.newsletter_verify_domain(${tenant}::uuid,${current.id}::uuid,${current.version}::integer,
      ${status?.ownership ?? false},${status?.spf ?? false},${status?.dkim ?? false},${status?.bounce ?? false},${status?.dmarc ?? false}) as checked`);
    if (!result?.checked) throw conflict("STALE_VERSION");
    const [row] = await tx.select().from(newsletterConnections).where(and(eq(newsletterConnections.tenantId, tenant), eq(newsletterConnections.id, current.id)));
    await audit(tx, tenant, actor, "newsletter.domain.verify", current.id, row.version);
    return domainResponse(row);
  });
}

/** One field, stored on the ministry's brand kit so new emails start with it. */
export function saveMailingAddress(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const input = addressInput.parse(raw);
    const [row] = await tx.select().from(newsletterBrandKits).where(eq(newsletterBrandKits.tenantId, tenant)).for("update");
    if (!row) {
      if (input.version) throw conflict("STALE_VERSION");
      const [created] = await tx.insert(newsletterBrandKits).values({ tenantId: tenant, kit: { ...defaultBrand, address: input.address } }).onConflictDoNothing().returning();
      if (!created) throw conflict("STALE_VERSION");
      await audit(tx, tenant, actor, "newsletter.brand_kit.save", tenant, 1);
      return { address: created.kit.address.trim(), version: created.version };
    }
    if (input.version !== row.version) throw conflict("STALE_VERSION");
    const [updated] = await tx.update(newsletterBrandKits).set({ kit: { ...row.kit, address: input.address }, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(newsletterBrandKits.tenantId, tenant)).returning();
    await audit(tx, tenant, actor, "newsletter.brand_kit.save", tenant, updated.version);
    return { address: updated.kit.address.trim(), version: updated.version };
  });
}

export { emailDomain };
