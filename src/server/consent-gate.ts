import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../db/client";
import { contacts } from "../db/schema";
import { consentPurposeRegistry, grantCountsOnChannel, type ConsentChannel, type ConsentPurpose } from "../lib/consent-purposes";

/**
 * HC-DEC1b: the ONE place that answers "may we contact this person for this purpose on this channel?".
 * Owned by the consent layer. Engineering defaults, UNAPPROVED pending legal review; this approves no sender,
 * notice, lawful basis or activation, and no sender for newsletter, follow-up or Auto-DMs exists.
 *
 * Rule (the SQL twin is `consentState` in crm-filters.ts; tests prove they agree on every ledger shape):
 * - the decision is derived from the append-only ledger at call time, never from a stored flag;
 * - a withdrawal on ANY channel is outstanding until a later grant on the SAME channel is later on both clocks, and blocks;
 * - a grant counts only while it is the latest event on its channel, only on a channel the purpose accepts
 *   (`purposeGrantChannels`: the newsletter is email-only), and, when a channel is asked for, only on that channel;
 * - missing, withdrawn, `legacy_unspecified`, redacted and erased all fail closed.
 * Reason codes carry no personal data. Callers that must be race-free lock the person row first, as `recordAssociation` does.
 */
export type ConsentReason = "consent_missing" | "consent_withdrawn" | "purpose_not_contactable" | "channel_not_permitted" | "person_unavailable";
export type LedgerEvent = { id: string; status: string; channel: string; occurred_at: string; recorded_at: string; source: string | null; outstanding: boolean };
export type ConsentDecision = { allowed: true; consentId: string; event: LedgerEvent } | { allowed: false; reason: ConsentReason; event: LedgerEvent | null };

/** Pure decision over one person's ledger rows for one purpose, newest first (as `loadLedger` returns them). */
export function decideConsent(rows: readonly LedgerEvent[], purpose: ConsentPurpose, channel?: ConsentChannel): ConsentDecision {
  if (!(purpose in consentPurposeRegistry) || purpose === "legacy_unspecified") return { allowed: false, reason: "purpose_not_contactable", event: null };
  if (channel && !grantCountsOnChannel(purpose, channel)) return { allowed: false, reason: "channel_not_permitted", event: null };
  const withdrawal = rows.find((row) => row.outstanding);
  if (withdrawal) return { allowed: false, reason: "consent_withdrawn", event: withdrawal };
  // Rows are newest first, so the first row per channel is that channel's effective event.
  const latest = new Map<string, string>();
  for (const row of rows) if (!latest.has(row.channel)) latest.set(row.channel, row.id);
  const grant = rows.find((row) => row.status === "granted" && latest.get(row.channel) === row.id && grantCountsOnChannel(purpose, row.channel) && (!channel || row.channel === channel));
  return grant ? { allowed: true, consentId: grant.id, event: grant } : { allowed: false, reason: "consent_missing", event: null };
}

/** One person's non-redacted ledger rows for one purpose, newest first, with outstanding withdrawals marked. */
export async function loadLedger(tx: Transaction, tenantId: string, contactId: string, purpose: ConsentPurpose): Promise<LedgerEvent[]> {
  const rows = await tx.execute<LedgerEvent>(sql`
    select c.id, c.status, c.channel, c.occurred_at, c.recorded_at, c.source,
      (c.status = 'withdrawn' and not exists (select 1 from contact_consents g where g.tenant_id = c.tenant_id and g.contact_id = c.contact_id
        and g.channel = c.channel and g.purpose = c.purpose and g.status = 'granted' and g.recorded_at > c.recorded_at and g.occurred_at > c.occurred_at)) as outstanding
    from contact_consents c
    where c.tenant_id = ${tenantId}::uuid and c.contact_id = ${contactId}::uuid and c.purpose = ${purpose} and c.redacted_at is null
    order by c.recorded_at desc, c.occurred_at desc, c.id desc`);
  return rows.rows;
}

/** The single send-time decision. Every sender of newsletter, follow-up, marketing or Auto-DM content must call this. */
export async function mayContact(tx: Transaction, tenantId: string, contactId: string, purpose: ConsentPurpose, channel: ConsentChannel): Promise<ConsentDecision> {
  const [person] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId), isNull(contacts.erasedAt)));
  if (!person) return { allowed: false, reason: "person_unavailable", event: null };
  return decideConsent(await loadLedger(tx, tenantId, contactId, purpose), purpose, channel);
}
