import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { createTask, listNotifications, markNotificationsRead, setNotificationPreferences, updateTask } from "../../src/server/crm-tasks";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string;
const hours = (value: number) => new Date(Date.now() + value * 3_600_000).toISOString();
const setDue = (id: string, value: string) => fixture.admin.query("update crm_tasks set due_at = $1 where id = $2", [value, id]);
const mine = async (user: string, workspace = tenant) => (await listNotifications(fixture.db, user, workspace)).items.filter((item) => item.kind !== "task_assigned");
const kinds = async (user: string) => (await mine(user)).map((item) => item.kind);
async function task(assignee: string | null, dueHoursAgo: number | null) {
  const created = await createTask(fixture.db, "owner-n", tenant, { title: `T ${Math.random()}`, body: "", priority: "none", assigneeUserId: assignee, dueAt: hours(48) });
  if (dueHoursAgo !== null) await setDue(created.id, hours(-dueHoursAgo));
  return created;
}

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-n", "ann", "bob", "cy", "owner-o"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, "owner-n", "Notices")).tenantId;
  other = (await createWorkspace(fixture.db, "owner-o", "Other")).tenantId;
  for (const id of ["ann", "bob", "cy"]) await putMember(fixture.db, "owner-n", tenant, `${id}@example.test`, "member");
});
afterAll(async () => { await fixture?.close(); });

describe("due and overdue task notifications", () => {
  it("fires due once within the first hour and overdue once afterwards, only for the assignee", async () => {
    const dueNow = await task("ann", 0.1), late = await task("ann", 5);
    const first = await mine("ann");
    expect(first.map((item) => [item.taskId, item.kind]).sort()).toEqual([[dueNow.id, "task_due"], [late.id, "task_overdue"]].sort());
    expect((await mine("ann")).length).toBe(2);
    expect(await mine("bob")).toEqual([]);
    expect(await mine("owner-n")).toEqual([]);
    expect(await mine("owner-o", other)).toEqual([]);
    expect(await mine("owner-o", tenant).catch(() => "denied")).toBe("denied");
    const count = await fixture.admin.query("select count(*)::int as n from crm_notifications where task_id = any($1) and kind <> 'task_assigned'", [[dueNow.id, late.id]]);
    expect(count.rows[0].n).toBe(2);
  });

  it("generates idempotently under concurrent loads", async () => {
    const created = await task("bob", 3);
    await Promise.all(Array.from({ length: 6 }, () => listNotifications(fixture.db, "bob", tenant)));
    expect((await mine("bob")).filter((item) => item.taskId === created.id)).toHaveLength(1);
  });

  it("does not fire for future, unassigned or done tasks and resets on reschedule", async () => {
    await task("cy", null); await task(null, 4);
    const done = await task("cy", 4);
    await updateTask(fixture.db, "owner-n", tenant, done.id, { version: done.version, status: "done" });
    expect(await mine("cy")).toEqual([]);
    const resched = await task("cy", 4);
    expect(await kinds("cy")).toEqual(["task_overdue"]);
    const { version } = (await updateTask(fixture.db, "owner-n", tenant, resched.id, { version: resched.version, dueAt: hours(24) }));
    expect(await mine("cy")).toEqual([]);
    await setDue(resched.id, hours(-6));
    expect(await kinds("cy")).toEqual(["task_overdue"]);
    expect(version).toBeGreaterThan(resched.version);
    const total = await fixture.admin.query("select count(*)::int as n from crm_notifications where task_id = $1 and kind = 'task_overdue'", [resched.id]);
    expect(total.rows[0].n).toBe(2);
  });

  it("withdraws on completion and moves to the new assignee on reassignment", async () => {
    const created = await task("ann", 5);
    expect((await mine("ann")).some((item) => item.taskId === created.id)).toBe(true);
    const moved = await updateTask(fixture.db, "owner-n", tenant, created.id, { version: created.version, assigneeUserId: "bob" });
    expect((await mine("ann")).some((item) => item.taskId === created.id)).toBe(false);
    expect((await mine("bob")).some((item) => item.taskId === created.id)).toBe(true);
    await updateTask(fixture.db, "owner-n", tenant, created.id, { version: moved.version, status: "done" });
    expect((await mine("bob")).some((item) => item.taskId === created.id)).toBe(false);
  });

  it("honours per-kind preferences and defaults on", async () => {
    expect((await listNotifications(fixture.db, "cy", tenant)).preferences).toEqual({ due: true, overdue: true });
    await task("cy", 0.2);
    expect(await kinds("cy")).toContain("task_due");
    await setNotificationPreferences(fixture.db, "cy", tenant, { due: false });
    expect(await kinds("cy")).not.toContain("task_due");
    await setNotificationPreferences(fixture.db, "cy", tenant, { overdue: false });
    expect(await kinds("cy")).toEqual([]);
    expect((await listNotifications(fixture.db, "cy", tenant)).preferences).toEqual({ due: false, overdue: false });
    expect((await listNotifications(fixture.db, "ann", tenant)).preferences).toEqual({ due: true, overdue: true });
  });

  it("gives nothing to a person who left the ministry and keeps notices private", async () => {
    const created = await task("bob", 6);
    await fixture.admin.query("delete from workspace_members where tenant_id = $1 and user_id = 'bob'", [tenant]);
    await expect(listNotifications(fixture.db, "bob", tenant)).rejects.toBeTruthy();
    const rows = await fixture.admin.query("select 1 from crm_notifications where task_id = $1 and recipient_user_id = 'bob' and kind = 'task_overdue'", [created.id]);
    expect(rows.rowCount).toBe(0);
    expect(await markNotificationsRead(fixture.db, "ann", tenant, "all")).toEqual({ marked: expect.any(Number) });
  });

  it("refuses a raw insert of a due notice for someone else", async () => {
    const created = await task("ann", 5);
    const { withTenant } = await import("../../src/server/tenancy");
    await expect(withTenant(fixture.db, "owner-n", tenant, "tasks:write", (tx) => tx.execute(`insert into crm_notifications (tenant_id, recipient_user_id, kind, task_id, due_at) values ('${tenant}', 'ann', 'task_due', '${created.id}', now())` as never))).rejects.toBeTruthy();
  });

  it("does not block erasure or merge of a linked contact", async () => {
    const A = await createContact(fixture.db, "owner-n", tenant, { name: "Synthetic Dup A" }), B = await createContact(fixture.db, "owner-n", tenant, { name: "Synthetic Dup B" });
    const a = A.id, b = B.id;
    const created = await createTask(fixture.db, "owner-n", tenant, { title: "Linked", body: "", priority: "none", assigneeUserId: "ann", dueAt: hours(48), contactId: a });
    await setDue(created.id, hours(-5));
    expect((await mine("ann")).some((item) => item.taskId === created.id)).toBe(true);
    await mergeContacts(fixture.db, "owner-n", tenant, a, { sourceId: b, targetVersion: A.version, sourceVersion: B.version });
    await eraseContact(fixture.db, "owner-n", tenant, a);
    expect((await mine("ann")).some((item) => item.taskId === created.id)).toBe(true);
  });
});
