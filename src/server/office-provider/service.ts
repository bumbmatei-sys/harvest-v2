import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { contacts, officeCalendarEvents, officeConnections, officeContactReferences, officeThreadMarkers } from "../../db/schema";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { officeEvidence, operationAvailable } from "./capabilities";
import { FakeOfficeProvider } from "./fake-provider";
import {
  auditOffice, calendarWritesOn, connectionAccount, officeConnection, officeLifecycle, OFFICE_MAIL_SEND_ENABLED,
  providerFailure, unavailable, withOffice, type OfficeDeps,
} from "./connections";
import { available, calendarWriteGrant, grant, officeActions, operationKind, providerOperations, ref, type OfficeRequest, type OfficeResult } from "./port";
import { OfficeProviderError, type ConnectionKind } from "./types";

const requestInput = z.strictObject({ action: z.enum(Object.keys(officeActions) as [keyof typeof officeActions, ...(keyof typeof officeActions)[]]),
  connectionId: z.string().optional(), input: z.unknown() });
const calendarWrites = new Set(["createEvent", "updateEvent", "deleteEvent"]);
const providerAction = (action: string) => Object.hasOwn(providerOperations, action);
const invalid = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"));

function parseRequest(data: unknown): OfficeRequest {
  const request = requestInput.parse(data);
  if (request.connectionId !== undefined && !z.uuid().safeParse(request.connectionId).success) throw unavailable();
  const parsed = { ...request, input: officeActions[request.action].parse(request.input) } as OfficeRequest;
  if (parsed.action === "events" || parsed.action === "freeBusy" || parsed.action === "availability") {
    const duration = Date.parse(parsed.input.end) - Date.parse(parsed.input.start);
    if (duration <= 0 || duration > 93 * 86_400_000) throw invalid();
  }
  return parsed;
}

function actionKind(request: OfficeRequest): ConnectionKind | undefined {
  switch (request.action) {
    case "marker":
    case "reviewMail":
    case "sendMail": return "mail";
    case "fileLink": return "files";
    case "eventLink": return "calendar";
    case "contactReferences":
    case "removeReference": return undefined;
    default: return operationKind[request.action as keyof typeof operationKind];
  }
}

async function requireContact(tx: Transaction, tenant: string, contactId: string) {
  const [row] = await tx.select({ id: contacts.id }).from(contacts).where(and(
    eq(contacts.tenantId, tenant), eq(contacts.id, contactId), isNull(contacts.erasedAt),
  )).for("share");
  if (!row) throw unavailable();
}

const markerFields = { ref: officeThreadMarkers.threadRef, read: officeThreadMarkers.read,
  starred: officeThreadMarkers.starred, contactId: officeThreadMarkers.contactId };
const visibleMarkerFields = { ...markerFields, contactId: sql<string | null>`case when ${contacts.id} is not null then ${officeThreadMarkers.contactId} end` };
const visibleMarkerContact = and(eq(contacts.tenantId, officeThreadMarkers.tenantId), eq(contacts.id, officeThreadMarkers.contactId), isNull(contacts.erasedAt));
const listWithRef = z.object({ items: z.array(z.object({ ref }).loose()) }).loose();
const calendarList = z.object({ items: z.array(z.object({ ref, primary: z.boolean().optional(), readOnly: z.boolean().optional() }).loose()) }).loose();
const eventList = z.object({ items: z.array(z.object({ ref, calendarRef: ref }).loose()) }).loose();
const writtenEvent = z.object({ ref }).loose();
/** Returned instead of throwing, so the refused attempt's audit row commits before the 409 is raised. */
const changedElsewhere = { conflict: true } as const;

export function runOffice(db: Database, actor: string, workspace: string, data: unknown, deps: OfficeDeps | null) {
  // Check the gate and membership before parsing request content for a visible ministry.
  return withOffice(db, actor, workspace, "office:connect", deps, async (_tx, _tenant, current) => current).then(async current => {
    const request = parseRequest(typeof data === "function" ? await data() : data);
    if (request.action === "startConnect" || request.action === "finishConnect" || request.action === "health" || request.action === "disconnect") {
      return officeLifecycle(db, actor, workspace, request, current);
    }
    const result = await runConnectionAction(db, actor, workspace, request, current);
    if ("conflict" in result) throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
    return result;
  });
}

type ConnectionAction = Exclude<OfficeRequest, { action: "startConnect" | "finishConnect" | "health" | "disconnect" }>;
function runConnectionAction(db: Database, actor: string, workspace: string, request: ConnectionAction, deps: OfficeDeps): Promise<OfficeResult | typeof changedElsewhere> {
  const kind = actionKind(request);
  return withOffice(db, actor, workspace, kind ? `office:${kind}` : "office:connect", deps, async (tx, tenant, { provider, credential, review, testDelivery }) => {
    const { action, input } = request;
    const row = await officeConnection(tx, tenant, actor, request.connectionId, false);
    if (kind && row.kind !== kind) throw unavailable();
    const base = { tenantId: tenant, ownerUserId: actor, connectionId: row.id };
    const markers = and(eq(officeThreadMarkers.tenantId, tenant), eq(officeThreadMarkers.ownerUserId, actor), eq(officeThreadMarkers.connectionId, row.id));
    const account = connectionAccount(row);
    const finish = async <T extends OfficeResult>(result: T, eventRef?: string) => {
      await auditOffice(tx, tenant, actor, action, row.id, result.state, eventRef);
      return result;
    };
    const writeEventRef = action === "updateEvent" || action === "deleteEvent" ? input.eventRef : undefined;

    if (action === "contactReferences" || action === "removeReference") {
      if (row.kind === "mail") throw unavailable();
      await requireContact(tx, tenant, input.contactId);
      const condition = and(eq(officeContactReferences.tenantId, tenant), eq(officeContactReferences.ownerUserId, actor),
        eq(officeContactReferences.connectionId, row.id), eq(officeContactReferences.contactId, input.contactId));
      if (action === "removeReference") {
        const [removed] = await tx.delete(officeContactReferences).where(and(condition, eq(officeContactReferences.itemRef, input.itemRef)))
          .returning({ ref: officeContactReferences.itemRef });
        if (!removed) throw unavailable();
        return finish(available({ removed: true }));
      }
      return finish(available({ items: await tx.select({
        ref: officeContactReferences.itemRef, kind: officeContactReferences.kind, name: officeContactReferences.name,
        startsAt: officeContactReferences.startsAt, endsAt: officeContactReferences.endsAt,
      }).from(officeContactReferences).where(condition).orderBy(officeContactReferences.itemRef) }));
    }

    const sender = testDelivery && provider instanceof FakeOfficeProvider ? provider : null;
    if (calendarWrites.has(action) && !calendarWritesOn(deps)) return finish({ state: "disabled" }, writeEventRef);
    if ((action === "reviewMail" || action === "sendMail") && !OFFICE_MAIL_SEND_ENABLED && !sender) {
      return finish({ state: "disabled" });
    }
    if (!account || row.provider !== provider.id || row.health === "reconnect_needed") return finish({ state: "reconnect_needed" });
    if (row.health !== "healthy" || (row.grants & ~calendarWriteGrant) !== grant[row.kind]) return finish({ state: "unavailable" });
    if (calendarWrites.has(action) && !(row.grants & calendarWriteGrant)) return finish({ state: "write_access_needed" }, writeEventRef);

    try {
      if (action === "reviewMail" || action === "sendMail") {
        if (!sender) return finish({ state: "disabled" });
        const binding = { tenantId: tenant, actorId: actor, connectionId: row.id, content: input.content };
        if (action === "reviewMail") {
          const token = review.issue(binding);
          return finish(token ? available(token) : { state: "temporarily_unavailable" });
        }
        if (!review.consume(input.reviewToken, binding)) {
          throw new AccessError(409, message("Office.reviewRequired"));
        }
        return finish(available(await sender.simulateDelivery(credential, account, input.content, input.reviewToken)));
      }
      if (action === "marker") {
        await provider.thread(credential, account, input.threadRef);
        if (input.contactId) await requireContact(tx, tenant, input.contactId);
        const { threadRef, ...change } = input;
        const [marker] = await tx.insert(officeThreadMarkers).values({ ...base, threadRef, ...change })
          .onConflictDoUpdate({ target: [officeThreadMarkers.tenantId, officeThreadMarkers.ownerUserId, officeThreadMarkers.connectionId, officeThreadMarkers.threadRef], set: change })
          .returning(markerFields);
        const [visible] = await tx.select(visibleMarkerFields).from(officeThreadMarkers).leftJoin(contacts, visibleMarkerContact)
          .where(and(markers, eq(officeThreadMarkers.threadRef, marker.ref)));
        return finish(available(visible));
      }
      if (action === "fileLink" || action === "eventLink") {
        await requireContact(tx, tenant, input.contactId);
        let values: Pick<typeof officeContactReferences.$inferInsert, "kind" | "itemRef" | "name" | "startsAt" | "endsAt">;
        if (action === "fileLink") {
          const file = await provider.file(credential, account, input.fileRef);
          if (file.kind !== "file") throw unavailable();
          values = { kind: "file", itemRef: file.ref, name: file.name };
        } else {
          const event = await provider.event(credential, account, input.eventRef, input.calendarRef);
          const startsAt = new Date(event.start), endsAt = new Date(event.end);
          if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) return finish({ state: "unavailable" });
          values = { kind: "event", itemRef: event.ref, startsAt, endsAt };
        }
        const [linked] = await tx.insert(officeContactReferences).values({ ...base, contactId: input.contactId, ...values })
          .onConflictDoUpdate({
            target: [officeContactReferences.tenantId, officeContactReferences.ownerUserId, officeContactReferences.connectionId,
              officeContactReferences.contactId, officeContactReferences.kind, officeContactReferences.itemRef],
            set: { name: values.name ?? null, startsAt: values.startsAt ?? null, endsAt: values.endsAt ?? null },
          }).returning({ ref: officeContactReferences.itemRef, kind: officeContactReferences.kind, name: officeContactReferences.name,
            startsAt: officeContactReferences.startsAt, endsAt: officeContactReferences.endsAt });
        return finish(available(linked));
      }
      if (!providerAction(action)) throw unavailable();
      if (!operationAvailable(account.platform, action, provider.id === "fake")) return finish({ state: "unavailable" });
      if (action === "createEvent" || action === "updateEvent" || action === "deleteEvent") {
        if (action !== "deleteEvent" && (input.event.attendees.length || (input.event.meeting && (account.platform === "google" ? officeEvidence.googleCalendar.meet : officeEvidence.microsoftCalendar.teams) !== "documented"))) throw invalid();
        const listed = await provider.perform(credential, account, { action: "calendars", input: {} });
        const target = listed.state === "available" ? calendarList.parse(listed.data).items.find(item => item.ref === input.calendarRef) : undefined;
        if (!target) return finish(listed.state === "available" ? { state: "unavailable" } : listed, writeEventRef);
        if (target.readOnly) throw invalid();
        const here = and(eq(officeCalendarEvents.tenantId, tenant), eq(officeCalendarEvents.ownerUserId, actor), eq(officeCalendarEvents.connectionId, row.id),
          eq(officeCalendarEvents.calendarRef, input.calendarRef));
        if (action !== "createEvent") {
          const [mine] = await tx.select({ ref: officeCalendarEvents.eventRef }).from(officeCalendarEvents).where(and(here, eq(officeCalendarEvents.eventRef, input.eventRef)));
          if (!mine) throw unavailable();
        }
        let result: OfficeResult;
        try { result = await provider.perform(credential, account, request); } catch (error) {
          if (error instanceof OfficeProviderError && error.code === "CONFLICT") {
            await auditOffice(tx, tenant, actor, action, row.id, "conflict", writeEventRef);
            return changedElsewhere;
          }
          throw error;
        }
        if (result.state !== "available") return finish(result, writeEventRef);
        const eventRef = action === "createEvent" ? writtenEvent.parse(result.data).ref : input.eventRef;
        if (action === "createEvent") {
          await tx.insert(officeCalendarEvents).values({ tenantId: tenant, ownerUserId: actor, connectionId: row.id, calendarRef: input.calendarRef, eventRef }).onConflictDoNothing();
          await tx.update(officeConnections).set({ writeCalendarRef: input.calendarRef }).where(and(eq(officeConnections.tenantId, tenant), eq(officeConnections.ownerUserId, actor), eq(officeConnections.id, row.id)));
        }
        if (action === "deleteEvent") await tx.delete(officeCalendarEvents).where(and(here, eq(officeCalendarEvents.eventRef, input.eventRef)));
        return finish(result, eventRef);
      }
      if (action === "thread") {
        const item = await provider.thread(credential, account, input.threadRef);
        const [marker] = await tx.select(visibleMarkerFields).from(officeThreadMarkers).leftJoin(contacts, visibleMarkerContact).where(and(markers, eq(officeThreadMarkers.threadRef, item.ref)));
        return finish(available({ ...item, marker: marker ?? { ref: item.ref, read: false, starred: false, contactId: null } }));
      }
      const result = await provider.perform(credential, account, request);
      if (result.state !== "available") return finish(result);
      if (action === "calendars" && input.writableOnly) {
        const page = calendarList.parse(result.data), items = page.items.filter(item => !item.readOnly);
        // The default is the calendar last used, else the connection's own primary calendar. A shared calendar is never chosen for the person.
        const defaultRef = items.find(item => item.ref === row.writeCalendarRef)?.ref ?? items.find(item => item.primary)?.ref ?? null;
        return finish(available({ ...page, items, defaultRef }));
      }
      if (action === "events" || action === "event") {
        const created = async (pairs: { ref: string; calendarRef: string }[]) => {
          const ids = pairs.map(pair => pair.ref);
          const rows = ids.length ? await tx.select({ ref: officeCalendarEvents.eventRef, calendarRef: officeCalendarEvents.calendarRef }).from(officeCalendarEvents)
            .where(and(eq(officeCalendarEvents.tenantId, tenant), eq(officeCalendarEvents.ownerUserId, actor), eq(officeCalendarEvents.connectionId, row.id), inArray(officeCalendarEvents.eventRef, ids))) : [];
          const keys = new Set(rows.map(item => `${item.calendarRef}\u0000${item.ref}`));
          return (pair: { ref: string; calendarRef: string }) => keys.has(`${pair.calendarRef}\u0000${pair.ref}`);
        };
        if (action === "event") { const one = writtenEvent.extend({ calendarRef: ref }).loose().parse(result.data); return finish(available({ ...one, createdHere: (await created([one]))(one) })); }
        const page = eventList.parse(result.data), isMine = await created(page.items);
        return finish(available({ ...page, items: page.items.map(item => ({ ...item, createdHere: isMine(item) })) }));
      }
      if (action !== "threads") return finish(result);
      const page = listWithRef.parse(result.data), ids = page.items.map(item => item.ref);
      const rows = ids.length ? await tx.select(visibleMarkerFields).from(officeThreadMarkers).leftJoin(contacts, visibleMarkerContact).where(and(markers, inArray(officeThreadMarkers.threadRef, ids))) : [];
      const byRef = new Map(rows.map(marker => [marker.ref, marker]));
      return finish(available({ ...page, items: page.items.map(item => ({ ...item,
        marker: byRef.get(item.ref) ?? { ref: item.ref, read: false, starred: false, contactId: null },
      })) }));
    } catch (error) {
      return finish(providerFailure(error));
    }
  });
}
