import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, listWorkspaces, putMember } from "../../src/server/workspaces";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner", "helper", "outsider"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
});
afterAll(async () => { await fixture?.close(); });

it("counts members per ministry for the people who belong to it, without crossing ministries", async () => {
  const a = (await createWorkspace(fixture.db, "owner", "Ministry A")).tenantId;
  const b = (await createWorkspace(fixture.db, "outsider", "Ministry B")).tenantId;
  await putMember(fixture.db, "owner", a, "helper@example.test", "member");
  const mine = await listWorkspaces(fixture.db, "helper");
  expect(mine.map((item) => [item.tenantId, item.role, item.memberCount])).toEqual([[a, "member", 2]]);
  const owners = await listWorkspaces(fixture.db, "owner");
  expect(owners.map((item) => [item.name, item.memberCount])).toEqual([["Ministry A", 2]]);
  expect((await listWorkspaces(fixture.db, "outsider")).map((item) => [item.tenantId, item.memberCount])).toEqual([[b, 1]]);
});
