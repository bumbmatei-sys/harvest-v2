import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import {
  contacts, crmNotifications, volunteerAssignments, volunteerAvailability, volunteerRequests, volunteerRoles, volunteerSlots, volunteers,
  workspaceMembers, workspaces,
} from "../db/schema";
import { message } from "../i18n/messages";
import { departmentKeys } from "../lib/campaign-wizard";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const uuid = z.uuid();
const day = z.iso.date();
const time = z.iso.datetime({ offset: true });
const userId = z.string().min(1).max(128);
const label = z.string().trim().min(1).max(120);
const noticeKinds = ["volunteer_assigned", "volunteer_changed", "volunteer_reminder", "volunteer_swap_requested"] as const;
const notFound = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const staff = (role: string) => role === "owner" || role === "admin";
const conflict = (code: string) => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { code });
const fromTo = z.strictObject({ from: day, to: day }).refine(range => range.from <= range.to);

const commandInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("role"), id: uuid.optional(), name: label, description: z.string().trim().max(2000).default(""),
    department: z.enum(departmentKeys).nullable().default(null), archived: z.boolean().default(false) }),
  z.strictObject({ action: z.literal("volunteer"), id: uuid.optional(), roleId: uuid, userId: userId.optional(), contactId: uuid.optional(),
    startDate: day, endDate: day.nullable().default(null), note: z.string().trim().max(2000).nullable().default(null) })
    .refine(p => Boolean(p.userId) !== Boolean(p.contactId) && (!p.endDate || p.endDate >= p.startDate)),
  z.strictObject({ action: z.literal("slot"), id: uuid.optional(), eventId: uuid.nullable().default(null), roleId: uuid,
    title: label, startsAt: time, endsAt: time, needed: z.number().int().min(1).max(500), open: z.boolean().default(false) })
    .refine(p => Date.parse(p.startsAt) < Date.parse(p.endsAt)),
  z.strictObject({ action: z.literal("assign"), slotId: uuid, userId: userId.optional(), volunteerId: uuid.optional() })
    .refine(p => Boolean(p.userId) !== Boolean(p.volunteerId)),
  z.strictObject({ action: z.literal("remove"), slotId: uuid, assignmentId: uuid }),
  z.strictObject({ action: z.enum(["signup", "decline"]), slotId: uuid }),
  z.strictObject({ action: z.literal("swap"), slotId: uuid, replacementUserId: userId }),
  // Founder decision 27 Nov: the named replacement accepts or declines a swap first; staff approve only an accepted swap.
  z.strictObject({ action: z.enum(["approve", "reject", "withdraw", "accept_swap", "decline_swap"]), requestId: uuid }),
  z.strictObject({ action: z.literal("availability"), date: day, unavailable: z.boolean() }),
  z.strictObject({ action: z.literal("reminder"), slotId: uuid, dueAt: time }),
]);

type RosterAction = { outcome: string; id?: string; warnings?: ("unavailable" | "double_booked")[]; counts?: Record<string, number> };

async function inRoster<T>(db: Database, user: string, tenant: string, run: (tx: Transaction, tenant: string, role: string) => Promise<T>) {
  try {
    return await withTenant(db, user, uuid.parse(tenant), "workspace:read", (tx, id, _effective, role) => {
      if (!staff(role) && role !== "member") throw notFound();
      return run(tx, id, role);
    });
  } catch (error) {
    if (error instanceof AccessError && error.status === 403) throw notFound();
    throw error;
  }
}

async function apply(tx: Transaction, tenant: string, action: string, values: { slot?: string; target?: string; id?: string; due?: string } = {}) {
  const { rows: [row] } = await tx.execute<{ result: RosterAction }>(sql`
    select public.volunteer_change(${tenant}::uuid,${action},${values.slot ?? null}::uuid,${values.target ?? null},
      ${values.id ?? null}::uuid,${values.due ?? null}::timestamptz) as result`);
  if (row.result.outcome === "missing") throw notFound();
  if (row.result.outcome !== "ok") throw conflict(row.result.outcome);
  return row.result;
}

export function getVolunteerRoster(db: Database, actor: string, tenant: string, range: unknown) {
  const { from, to } = fromTo.parse(range);
  return inRoster(db, actor, tenant, async (tx, scope, role) => {
    const roles = await tx.select().from(volunteerRoles).where(eq(volunteerRoles.tenantId, scope)).orderBy(asc(volunteerRoles.name));
    const slots = await tx.select().from(volunteerSlots).where(and(
      eq(volunteerSlots.tenantId, scope), gte(volunteerSlots.serviceDate, from), lte(volunteerSlots.serviceDate, to),
    )).orderBy(asc(volunteerSlots.startsAt), asc(volunteerSlots.id));
    const counts = slots.length ? (await apply(tx, scope, "counts")).counts ?? {} : {};
    const ids = slots.map(slot => slot.id);
    const assignments = ids.length ? await tx.select().from(volunteerAssignments)
      .where(and(eq(volunteerAssignments.tenantId, scope), inArray(volunteerAssignments.slotId, ids))) : [];
    const requests = ids.length ? await tx.select().from(volunteerRequests)
      .where(and(eq(volunteerRequests.tenantId, scope), inArray(volunteerRequests.slotId, ids))) : [];
    const availability = await tx.select().from(volunteerAvailability).where(and(eq(volunteerAvailability.tenantId, scope),
      gte(volunteerAvailability.unavailableDate, from), lte(volunteerAvailability.unavailableDate, to)));
    const directory = staff(role) ? await tx.select().from(volunteers).where(eq(volunteers.tenantId, scope)) : undefined;
    return { roles, slots: slots.map(slot => ({ ...slot, filled: counts[slot.id] ?? 0 })), assignments, requests, availability, volunteers: directory };
  });
}

export function changeVolunteerRoster(db: Database, actor: string, tenant: string, raw: unknown) {
  const input = commandInput.parse(raw);
  return inRoster(db, actor, tenant, async (tx, scope, role) => {
    // Use the same lock as the assignment definer so role, availability and slot edits serialize with assignments.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('volunteer:' || ${scope}, 0))`);
    const { action } = input;
    if (action === "availability") {
      if (input.unavailable) await tx.insert(volunteerAvailability)
        .values({ tenantId: scope, userId: actor, unavailableDate: input.date }).onConflictDoNothing();
      else await tx.delete(volunteerAvailability).where(and(eq(volunteerAvailability.tenantId, scope),
        eq(volunteerAvailability.userId, actor), eq(volunteerAvailability.unavailableDate, input.date)));
      return { outcome: "ok" };
    }
    if (action === "role") {
      if (!staff(role)) throw notFound();
      const { id, name, description, department, archived } = input;
      const data = { name, description, department, archived };
      const [saved] = id ? await tx.update(volunteerRoles).set(data)
        .where(and(eq(volunteerRoles.tenantId, scope), eq(volunteerRoles.id, id))).returning() :
        await tx.insert(volunteerRoles).values({ tenantId: scope, ...data }).returning();
      if (!saved) throw notFound();
      return saved;
    }
    if (action === "volunteer") {
      if (!staff(role)) throw notFound();
      const { id, roleId, userId, contactId, startDate, endDate, note } = input;
      const [active] = await tx.select().from(volunteerRoles).where(and(eq(volunteerRoles.tenantId, scope), eq(volunteerRoles.id, roleId)));
      if (!active || (!id && active.archived)) throw notFound();
      if (contactId) {
        const [person] = await tx.select({ id: contacts.id }).from(contacts).where(and(
          eq(contacts.tenantId, scope), eq(contacts.id, contactId), isNull(contacts.erasedAt),
        ));
        if (!person) throw notFound();
      } else if (userId) {
        const [membership] = await tx.select({ role: workspaceMembers.roleId }).from(workspaceMembers).where(and(
          eq(workspaceMembers.tenantId, scope), eq(workspaceMembers.userId, userId),
        ));
        if (!membership || (!staff(membership.role) && membership.role !== "member")) throw notFound();
      }
      const data = { roleId, userId: userId ?? null, contactId: contactId ?? null, startDate, endDate, note };
      const [saved] = id ? await tx.update(volunteers).set({ startDate, endDate, note })
        .where(and(eq(volunteers.tenantId, scope), eq(volunteers.id, id), eq(volunteers.roleId, roleId),
          userId ? eq(volunteers.userId, userId) : eq(volunteers.contactId, contactId!))).returning() :
        await tx.insert(volunteers).values({ tenantId: scope, ...data }).returning();
      if (!saved) throw notFound();
      return saved;
    }
    if (action === "slot") {
      if (!staff(role)) throw notFound();
      const { id, eventId, roleId, title, needed, open } = input;
      const [active] = await tx.select().from(volunteerRoles).where(and(eq(volunteerRoles.tenantId, scope), eq(volunteerRoles.id, roleId), eq(volunteerRoles.archived, false)));
      if (!active) throw notFound();
      if (eventId) {
        const { rows: [event] } = await tx.execute<{ outcome: string }>(sql`
          select public.events_operate(${scope}::uuid,${eventId}::uuid,'get','{}'::jsonb)->>'outcome' as outcome`);
        if (event?.outcome !== "ok") throw notFound();
      }
      const [workspace] = await tx.select({ zone: workspaces.timeZone }).from(workspaces).where(eq(workspaces.tenantId, scope));
      const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
      const serviceDate = new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeZone: workspace.zone }).format(startsAt);
      const data = { roleId, eventId, title, needed, open, startsAt, endsAt, serviceDate };
      if (!id) return (await tx.insert(volunteerSlots).values({ tenantId: scope, ...data }).returning())[0];
      const [before] = await tx.select().from(volunteerSlots).where(and(eq(volunteerSlots.tenantId, scope), eq(volunteerSlots.id, id)));
      if (!before || before.roleId !== roleId) throw notFound();
      const filled = (await apply(tx, scope, "counts")).counts?.[id] ?? 0;
      if (needed < filled) throw conflict("full");
      const [saved] = await tx.update(volunteerSlots).set(data)
        .where(and(eq(volunteerSlots.tenantId, scope), eq(volunteerSlots.id, id))).returning();
      if (filled && (before.title !== title || before.startsAt.getTime() !== startsAt.getTime() || before.endsAt.getTime() !== endsAt.getTime() || before.eventId !== eventId)) {
        await apply(tx, scope, "announce", { slot: id });
      }
      return saved;
    }
    if (action === "assign") return apply(tx, scope, action, { slot: input.slotId, target: input.userId, id: input.volunteerId });
    if (action === "remove") return apply(tx, scope, action, { slot: input.slotId, id: input.assignmentId });
    if (action === "swap") return apply(tx, scope, action, { slot: input.slotId, target: input.replacementUserId });
    if (action === "reminder") return apply(tx, scope, action, { slot: input.slotId, due: input.dueAt });
    if ("requestId" in input) return apply(tx, scope, action, { id: input.requestId });
    return apply(tx, scope, action, { slot: input.slotId });
  });
}

export function volunteerNotifications(db: Database, actor: string, tenant: string, mark?: unknown) {
  return inRoster(db, actor, tenant, async (tx, scope) => {
    const own = and(eq(crmNotifications.tenantId, scope), eq(crmNotifications.recipientUserId, actor),
      inArray(crmNotifications.kind, [...noticeKinds]));
    if (mark !== undefined) {
      const ids = z.strictObject({ ids: z.union([z.literal("all"), z.array(uuid).min(1).max(100)]) }).parse(mark).ids;
      const done = await tx.update(crmNotifications).set({ readAt: new Date() }).where(and(
        own, isNull(crmNotifications.readAt), ids === "all" ? undefined : inArray(crmNotifications.id, ids),
      )).returning({ id: crmNotifications.id });
      return { updated: done.length };
    }
    const notices = await tx.select({ id: crmNotifications.id, slotId: crmNotifications.volunteerSlotId, kind: crmNotifications.kind,
      dueAt: crmNotifications.dueAt, readAt: crmNotifications.readAt, createdAt: crmNotifications.createdAt })
      .from(crmNotifications).where(own).orderBy(desc(crmNotifications.createdAt), desc(crmNotifications.id)).limit(50);
    return { items: notices };
  });
}
