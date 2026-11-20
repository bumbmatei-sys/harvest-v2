import { and, asc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction, Database } from "../../db/client";
import { contacts, contactIdentifiers, crmSavedViews, newsletterLists, newsletterSegments,
  newsletterSubscribers, newsletterSubscriptions, newsletterSkipReasons } from "../../db/schema";
import { peopleQuery } from "../contacts";
import { mayContact } from "../consent-gate";
import { loadDefinitions } from "../crm-filters";
import { segmentState } from "../newsletter";
import { conflict, unavailable, withNewsletter } from "./access";

const ids = z.array(z.uuid()).max(20).transform(values => [...new Set(values)].sort());
export const selectionInput = z.object({ listIds: ids.refine(values => values.length > 0), segmentIds: ids.default([]) }).strict();
export type Selection = z.infer<typeof selectionInput>;
export type Skip = typeof newsletterSkipReasons[number];

export async function selectionPins(tx: Transaction, tenant: string, selection: Selection) {
  const lists = await tx.select().from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenant),
    inArray(newsletterLists.id, selection.listIds))).orderBy(asc(newsletterLists.id)).for("share");
  const segments = selection.segmentIds.length ? await tx.select({
    id: newsletterSegments.id, audienceId: newsletterSegments.audienceId, version: newsletterSegments.savedViewVersion,
  }).from(newsletterSegments).innerJoin(crmSavedViews, and(eq(crmSavedViews.tenantId, tenant),
    eq(crmSavedViews.id, newsletterSegments.savedViewId), eq(crmSavedViews.version, newsletterSegments.savedViewVersion),
    isNull(crmSavedViews.ownerUserId), eq(crmSavedViews.objectType, "person"),
    sql`coalesce(${crmSavedViews.state}->'sources','[]'::jsonb)='[]'::jsonb`))
    .where(and(eq(newsletterSegments.tenantId, tenant), inArray(newsletterSegments.id, selection.segmentIds)))
    .orderBy(asc(newsletterSegments.id)).for("share") : [];
  if (lists.length !== selection.listIds.length || segments.length !== selection.segmentIds.length ||
      segments.some(segment => !lists.some(list => list.audienceId === segment.audienceId))) throw unavailable();
  return { lists, segments };
}

const maximumMemberships = 5000;
export async function resolveRecipients(tx: Transaction, tenant: string, selection: Selection,
  pins: Awaited<ReturnType<typeof selectionPins>>) {
  const base = and(eq(newsletterSubscriptions.tenantId, tenant), inArray(newsletterSubscriptions.listId, selection.listIds));
  const filters = [];
  for (const segment of pins.segments) {
    const state = await segmentState(tx, tenant, segment.id);
    filters.push(and(inArray(newsletterSubscriptions.listId, pins.lists.filter(list => list.audienceId === segment.audienceId).map(list => list.id)),
      peopleQuery(tx, tenant, state, await loadDefinitions(tx, tenant, "person"), false).where));
  }
  const rows = await tx.select({ subscriberId: newsletterSubscribers.id, contactId: contacts.id, listId: newsletterSubscriptions.listId,
    globalSuppressed: newsletterSubscribers.suppressed, state: newsletterSubscriptions.state, subscriptionVersion: newsletterSubscriptions.version,
    addressId: sql<string | null>`(select ${contactIdentifiers.id} from ${contactIdentifiers}
      where ${contactIdentifiers.tenantId}=${tenant}::uuid and ${contactIdentifiers.contactId}=${contacts.id}
      and ${contactIdentifiers.kind}='email')`,
    addressBlock: sql<"global_suppressed" | "list_suppressed" | null>`(select public.newsletter_address_block(
      ${tenant}::uuid,${contactIdentifiers.normalizedValue},${newsletterSubscriptions.listId}) from ${contactIdentifiers}
      where ${contactIdentifiers.tenantId}=${tenant}::uuid and ${contactIdentifiers.contactId}=${contacts.id}
      and ${contactIdentifiers.kind}='email')`,
    hasAddress: exists(tx.select({ id: contactIdentifiers.id }).from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenant),
      eq(contactIdentifiers.contactId, contacts.id), eq(contactIdentifiers.kind, "email")))),
    contactVersion: contacts.version,
  }).from(newsletterSubscriptions).innerJoin(newsletterSubscribers, and(eq(newsletterSubscribers.tenantId, tenant),
    eq(newsletterSubscribers.id, newsletterSubscriptions.subscriberId))).innerJoin(contacts, and(eq(contacts.tenantId, tenant),
    eq(contacts.id, newsletterSubscribers.contactId), isNull(contacts.erasedAt)))
    .where(and(base, filters.length ? or(...filters) : undefined))
    .orderBy(asc(contacts.id), asc(newsletterSubscriptions.listId)).limit(maximumMemberships + 1);
  if (rows.length > maximumMemberships) throw conflict("SELECTION_LIMIT");
  const groups = Map.groupBy(rows, row => row.contactId);
  const recipients = [];
  const skipped: Partial<Record<Skip, number>> = {};
  let eligible = 0;
  for (const [contactId, memberships] of groups) {
    const subscribed = memberships.find(row => row.state === "subscribed" && !row.addressBlock);
    const row = subscribed ?? memberships[0];
    let reason: Skip | null = null;
    if (row.globalSuppressed || row.addressBlock === "global_suppressed") reason = "global_suppressed";
    else if (!subscribed) reason = memberships.some(item => item.state === "bounced" || item.state === "suppressed" || item.addressBlock === "list_suppressed") ? "list_suppressed" : "not_subscribed";
    else {
      const decision = await mayContact(tx, tenant, contactId, "newsletter", "email");
      if (!decision.allowed) reason = decision.reason === "consent_withdrawn" ? decision.reason : "consent_missing";
      else if (!row.hasAddress) reason = "address_unavailable";
    }
    if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
    else eligible++;
    recipients.push({ ...row, reason });
  }
  return { recipients, estimate: { kind: "estimate" as const, selected: recipients.length, eligible, skipped } };
}

export function estimateRecipients(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const selection = selectionInput.parse(raw);
    return (await resolveRecipients(tx, tenant, selection, await selectionPins(tx, tenant, selection))).estimate;
  });
}
