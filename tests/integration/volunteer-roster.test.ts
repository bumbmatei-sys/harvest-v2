import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { changeVolunteerRoster, getVolunteerRoster, volunteerNotifications } from "../../src/server/volunteer-roster";
import { withUser } from "../../src/server/tenancy";

const owner = "roster-owner", admin = "roster-admin", member = "roster-member", otherMember = "roster-substitute", viewer = "roster-viewer";
const outsider = "roster-outsider", third = "roster-third";
const missing = { status: 404 };
const day = new Date(Date.now() + 172_800_000).toISOString().slice(0, 10);
const startsAt = `${day}T10:00:00Z`, endsAt = `${day}T11:30:00Z`;
const range = { from: day, to: day };
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string, roleId: string, contactId: string, event: string;
const run = (who: string, data: unknown) => changeVolunteerRoster(f.db, who, tenant, data);
const roster = (who: string) => getVolunteerRoster(f.db, who, tenant, range);
const slot = (title: string, extra: Record<string, unknown> = {}) => run(admin, { action: "slot", title, startsAt, endsAt, roleId, needed: 1, open: true, ...extra });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, admin, member, otherMember, viewer, outsider, third].map(id => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Roster ministry", "church")).tenantId;
  other = (await createWorkspace(f.db, outsider, "Outside ministry", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin'), ($1,$3,'member'), ($1,$4,'member'), ($1,$5,'viewer'), ($1,$6,'member')", [tenant, admin, member, otherMember, viewer, third]);
  contactId = (await f.admin.query("insert into contacts(tenant_id,name) values($1,'Synthetic volunteer') returning id", [tenant])).rows[0].id;
  event = randomUUID();
  await f.admin.query("insert into events(tenant_id,id,title,time_zone,starts_at,ends_at) values($1,$2,'Foreign event','UTC',$3,$4)", [other, event, startsAt, endsAt]);
  roleId = (await run(owner, { action: "role", name: "Welcome team", department: "volunteers" })).id!;
}, 120_000);
afterAll(async () => { await f?.close(); });

it("isolates ministries, hides CRM people and notes from members, and enforces event scope", async () => {
  const volunteer = await run(admin, { action: "volunteer", roleId, contactId, startDate: day, note: "Staff note" });
  const registered = await run(owner, { action: "volunteer", roleId, userId: member, startDate: day, note: "Staff note" });
  await expect(slot("Wrong event", { eventId: event })).rejects.toMatchObject(missing);
  const ownEvent = randomUUID();
  await f.admin.query("insert into events(tenant_id,id,title,time_zone,starts_at,ends_at) values($1,$2,'Local event','UTC',$3,$4)", [tenant, ownEvent, startsAt, endsAt]);
  const linked = await slot("Linked event", { eventId: ownEvent });
  expect(linked).toHaveProperty("eventId", ownEvent);
  await run(admin, { action: "assign", slotId: linked.id, volunteerId: volunteer.id });
  expect((await roster(admin)).volunteers).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: volunteer.id, contactId, note: "Staff note" }),
    expect.objectContaining({ id: registered.id, userId: member }),
  ]));
  const visible = await roster(member);
  expect(visible.volunteers).toBeUndefined();
  expect(visible.assignments).toEqual([]);
  expect(visible.slots[0]).toMatchObject({ needed: 1, filled: 1 });
  await expect(roster(outsider)).rejects.toMatchObject(missing);
  await expect(roster(viewer)).rejects.toMatchObject(missing);
  await expect(run(member, { action: "role", name: "Invalid staff action" })).rejects.toMatchObject(missing);
  const direct = await withUser(f.db, outsider, async tx => {
    await tx.execute(sql`select set_config('app.tenant_id',${tenant},true)`);
    return tx.execute(sql`select * from volunteer_roles`);
  });
  expect(direct.rows).toEqual([]);
});

it("serializes capacity and returns warnings for unavailable and overlapping assignments", async () => {
  const first = await slot("First");
  const second = await slot("Second");
  await run(member, { action: "availability", date: day, unavailable: true });
  expect(await run(admin, { action: "assign", slotId: first.id, userId: member })).toMatchObject({ warnings: ["unavailable"] });
  expect(await run(member, { action: "signup", slotId: second.id })).toMatchObject({ warnings: ["unavailable", "double_booked"] });
  await expect(run(otherMember, { action: "signup", slotId: second.id })).rejects.toMatchObject({ status: 409, details: { code: "full" } });
  const race = await slot("Concurrent slot");
  const outcomes = await Promise.allSettled([
    run(member, { action: "signup", slotId: race.id }), run(otherMember, { action: "signup", slotId: race.id }),
  ]);
  expect(outcomes.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect((await roster(member)).assignments.every(row => row.userId === member)).toBe(true);
});

const assigned = async (slotId: string | undefined) => (await f.admin.query(
  "select user_id from volunteer_assignments where tenant_id=$1 and slot_id=$2 order by user_id", [tenant, slotId])).rows.map(row => row.user_id);

it("makes the named replacement accept a swap before staff can approve it", async () => {
  const shift = await slot("Accept first");
  await run(member, { action: "signup", slotId: shift.id });
  const swap = await run(member, { action: "swap", slotId: shift.id, replacementUserId: otherMember });
  expect((await volunteerNotifications(f.db, otherMember, tenant)).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "volunteer_swap_requested", slotId: shift.id }),
  ]));
  expect((await roster(otherMember)).requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: swap.id, replacementUserId: otherMember, state: "pending", replacementAcceptedAt: null }),
  ]));
  // Staff cannot approve before the replacement accepts.
  await expect(run(admin, { action: "approve", requestId: swap.id })).rejects.toMatchObject({ status: 409, details: { code: "awaiting_replacement" } });
  // Nobody else can answer for the replacement: not a third member, not the requester, not staff.
  for (const who of [third, member, admin, owner]) {
    await expect(run(who, { action: "accept_swap", requestId: swap.id })).rejects.toMatchObject(missing);
    await expect(run(who, { action: "decline_swap", requestId: swap.id })).rejects.toMatchObject(missing);
  }
  expect(await assigned(shift.id)).toEqual([member]);
  await run(otherMember, { action: "accept_swap", requestId: swap.id });
  await expect(run(otherMember, { action: "accept_swap", requestId: swap.id })).rejects.toMatchObject({ status: 409 });
  expect(await assigned(shift.id)).toEqual([member]);
  await run(admin, { action: "approve", requestId: swap.id });
  expect(await assigned(shift.id)).toEqual([otherMember]);
});

it("keeps the original assignment when the replacement declines", async () => {
  const shift = await slot("Decline keeps");
  await run(member, { action: "signup", slotId: shift.id });
  const swap = await run(member, { action: "swap", slotId: shift.id, replacementUserId: otherMember });
  await run(otherMember, { action: "decline_swap", requestId: swap.id });
  expect((await f.admin.query("select state from volunteer_requests where id=$1", [swap.id])).rows[0].state).toBe("declined");
  expect(await assigned(shift.id)).toEqual([member]);
  await expect(run(admin, { action: "approve", requestId: swap.id })).rejects.toMatchObject({ status: 409 });
  await expect(run(otherMember, { action: "accept_swap", requestId: swap.id })).rejects.toMatchObject({ status: 409 });
  expect(await assigned(shift.id)).toEqual([member]);
  expect((await volunteerNotifications(f.db, member, tenant)).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "volunteer_changed", slotId: shift.id }),
  ]));
  // A new request can follow the closed one.
  await run(member, { action: "swap", slotId: shift.id, replacementUserId: third });
});

it("checks capacity and booking again at the moment of an accepted swap", async () => {
  const shift = await slot("Swap checks", { needed: 2 });
  const overlap = await slot("Overlapping");
  await run(member, { action: "signup", slotId: shift.id });
  const swap = await run(member, { action: "swap", slotId: shift.id, replacementUserId: third });
  await run(third, { action: "accept_swap", requestId: swap.id });
  // After accepting, the replacement took the other place in the same slot.
  await run(third, { action: "signup", slotId: shift.id });
  await expect(run(admin, { action: "approve", requestId: swap.id })).rejects.toMatchObject({ status: 409, details: { code: "conflict" } });
  await run(admin, { action: "remove", slotId: shift.id, assignmentId: (await f.admin.query(
    "select id from volunteer_assignments where slot_id=$1 and user_id=$2", [shift.id, third])).rows[0].id });
  // Capacity shrank below what the slot already holds (an edge the staff form refuses; forced here).
  await run(admin, { action: "assign", slotId: shift.id, userId: otherMember });
  await f.admin.query("update volunteer_slots set needed = 1 where id = $1", [shift.id]);
  await expect(run(admin, { action: "approve", requestId: swap.id })).rejects.toMatchObject({ status: 409, details: { code: "full" } });
  await f.admin.query("update volunteer_slots set needed = 2 where id = $1", [shift.id]);
  // The replacement is now booked in an overlapping slot: the swap goes ahead with the warning.
  await run(third, { action: "signup", slotId: overlap.id });
  expect(await run(admin, { action: "approve", requestId: swap.id })).toMatchObject({ warnings: ["double_booked"] });
  expect(await assigned(shift.id)).toEqual([otherMember, third].sort());
});

it("resolves swap and decline requests, queues data-only reminders and hides archived roles", async () => {
  const shift = await slot("Swap shift");
  await run(member, { action: "signup", slotId: shift.id });
  const swap = await run(member, { action: "swap", slotId: shift.id, replacementUserId: otherMember });
  await expect(run(otherMember, { action: "approve", requestId: swap.id })).rejects.toMatchObject(missing);
  await run(otherMember, { action: "accept_swap", requestId: swap.id });
  await run(admin, { action: "approve", requestId: swap.id });
  expect((await roster(otherMember)).assignments.some(row => row.slotId === shift.id)).toBe(true);
  const dueAt = `${day}T08:00:00Z`;
  for (let i = 0; i < 2; i++) await run(admin, { action: "reminder", slotId: shift.id, dueAt });
  const reminders = await volunteerNotifications(f.db, otherMember, tenant);
  expect(reminders.items?.filter(notice => notice.kind === "volunteer_reminder")).toHaveLength(1);
  const decline = await run(otherMember, { action: "decline", slotId: shift.id });
  await run(owner, { action: "approve", requestId: decline.id });
  expect((await roster(member)).slots.find(row => row.id === shift.id)).toMatchObject({ filled: 0 });
  expect((await volunteerNotifications(f.db, member, tenant)).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "volunteer_changed", slotId: shift.id }),
  ]));
  await run(owner, { action: "role", id: roleId, name: "Welcome team", archived: true });
  const visible = await roster(member);
  expect(visible.roles).toEqual([]);
  expect(visible.slots).toEqual([]);
  await expect(run(member, { action: "signup", slotId: shift.id })).rejects.toMatchObject(missing);
  await expect(f.workerPool.query("select * from volunteer_slots")).rejects.toMatchObject({ code: "42501" });
});
