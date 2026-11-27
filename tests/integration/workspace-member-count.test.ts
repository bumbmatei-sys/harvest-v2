import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, listWorkspaces, putMember } from "../../src/server/workspaces";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner", "helper", "outsider", "partner", "visitor"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
});
afterAll(async () => { await fixture?.close(); });

it("counts members per ministry for the people who belong to it, without crossing ministries", async () => {
  const a = (await createWorkspace(fixture.db, "owner", "Ministry A")).tenantId;
  await createWorkspace(fixture.db, "outsider", "Ministry B");
  await putMember(fixture.db, "owner", a, "helper@example.test", "member");
  const mine = await listWorkspaces(fixture.db, "helper");
  expect(mine.map((item) => [item.tenantId, item.role, item.memberCount])).toEqual([[a, "member", 2]]);
  await putMember(fixture.db, "owner", a, "outsider@example.test", "viewer");
  expect((await listWorkspaces(fixture.db, "outsider")).map((item) => [item.name, item.role, item.memberCount]).sort()).toEqual([["Ministry A", "viewer", 3], ["Ministry B", "owner", 1]]);
  const owners = await listWorkspaces(fixture.db, "owner");
  expect(owners.map((item) => [item.name, item.memberCount])).toEqual([["Ministry A", 3]]);
});

it("counts everyone with access, collaborators and guests included, and returns their own role", async () => {
  const c = (await createWorkspace(fixture.db, "owner", "Ministry C")).tenantId;
  // Collaborators and guests join by accepting an invitation; insert the accepted rows directly (a collaborator with one area grant).
  await fixture.admin.query("insert into workspace_members (tenant_id, user_id, role_id) values ($1, 'partner', 'collaborator'), ($1, 'visitor', 'guest')", [c]);
  expect((await listWorkspaces(fixture.db, "visitor")).map((item) => [item.name, item.role, item.memberCount])).toEqual([["Ministry C", "guest", 3]]);
  expect((await listWorkspaces(fixture.db, "partner")).map((item) => [item.name, item.role, item.memberCount])).toEqual([["Ministry C", "collaborator", 3]]);
  // The people of Ministry C are not counted for Ministry A.
  expect((await listWorkspaces(fixture.db, "owner")).map((item) => [item.name, item.memberCount]).sort()).toEqual([["Ministry A", 3], ["Ministry C", 3]]);
});
