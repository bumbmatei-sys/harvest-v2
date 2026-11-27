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
const outsider = "roster-outsider";
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
  await f.db.insert(users).values([owner, admin, member, otherMember, viewer, outsider].map(id => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Roster ministry", "church")).tenantId;
  other = (await createWorkspace(f.db, outsider, "Outside ministry", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values ($1,$2,'admin'), ($1,$3,'member'), ($1,$4,'member'), ($1,$5,'viewer')", [tenant, admin, member, otherMember, viewer]);
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

it("resolves swap and decline requests, queues data-only reminders and hides archived roles", async () => {
  const shift = await slot("Swap shift");
  await run(member, { action: "signup", slotId: shift.id });
  const swap = await run(member, { action: "swap", slotId: shift.id, replacementUserId: otherMember });
  await expect(run(otherMember, { action: "approve", requestId: swap.id })).rejects.toMatchObject(missing);
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
