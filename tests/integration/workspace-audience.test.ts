import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, getWorkspace, listWorkspaces, putMember, updateWorkspaceAudience } from "../../src/server/workspaces";

// PR B: a ministry (internally a workspace) records its audience; owners and admins may change it.
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, foreign: string;

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(["a-owner", "a-admin", "a-member", "a-viewer", "a-foreign"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, "a-owner", "Grace Fellowship", "church")).tenantId;
  foreign = (await createWorkspace(f.db, "a-foreign", "Elsewhere", "evangelist_missionary")).tenantId;
  await putMember(f.db, "a-owner", tenant, "a-admin@example.test", "admin");
  await putMember(f.db, "a-owner", tenant, "a-member@example.test", "member");
  await putMember(f.db, "a-owner", tenant, "a-viewer@example.test", "viewer");
});
afterAll(async () => { await f?.close(); });

it("stores the audience chosen at creation and lists it for members", async () => {
  expect((await getWorkspace(f.db, "a-viewer", tenant)).audience).toBe("church");
  expect((await listWorkspaces(f.db, "a-member")).find((item) => item.tenantId === tenant)?.audience).toBe("church");
});

it("leaves the audience unspecified for ministries created without one", async () => {
  const legacy = await createWorkspace(f.db, "a-owner", "Older ministry");
  expect((await getWorkspace(f.db, "a-owner", legacy.tenantId)).audience).toBeNull();
});

it("rejects an audience outside the three values, in the service and in the database", async () => {
  // @ts-expect-error deliberately invalid
  await expect(createWorkspace(f.db, "a-owner", "Bad", "creator")).rejects.toThrow();
  await expect(updateWorkspaceAudience(f.db, "a-owner", tenant, { audience: "creator" })).rejects.toThrow();
  await expect(updateWorkspaceAudience(f.db, "a-owner", tenant, { audience: "church", extra: true })).rejects.toThrow();
  await expect(f.admin.query("update workspaces set audience = 'creator' where tenant_id = $1", [tenant])).rejects.toThrow(/workspace_audience/);
});

it("lets owners and admins change the audience and audits each change", async () => {
  expect((await updateWorkspaceAudience(f.db, "a-admin", tenant, { audience: "ministry_nonprofit" })).audience).toBe("ministry_nonprofit");
  expect((await updateWorkspaceAudience(f.db, "a-owner", tenant, { audience: "evangelist_missionary" })).audience).toBe("evangelist_missionary");
  const audit = (await f.admin.query("select actor_id, metadata from audit_logs where tenant_id = $1 and action = 'workspace.audience_update' order by id", [tenant])).rows;
  expect(audit).toEqual([
    { actor_id: "a-admin", metadata: { audience: "ministry_nonprofit", previousAudience: "church" } },
    { actor_id: "a-owner", metadata: { audience: "evangelist_missionary", previousAudience: "ministry_nonprofit" } },
  ]);
});

it("refuses members, viewers and other ministries", async () => {
  await expect(updateWorkspaceAudience(f.db, "a-member", tenant, { audience: "church" })).rejects.toMatchObject({ status: 403 });
  await expect(updateWorkspaceAudience(f.db, "a-viewer", tenant, { audience: "church" })).rejects.toMatchObject({ status: 403 });
  // Non-members get the existing tenancy denial (403), never another ministry's data.
  await expect(updateWorkspaceAudience(f.db, "a-owner", foreign, { audience: "church" })).rejects.toMatchObject({ status: 403 });
  expect((await getWorkspace(f.db, "a-foreign", foreign)).audience).toBe("evangelist_missionary");
  expect((await getWorkspace(f.db, "a-owner", tenant)).audience).toBe("evangelist_missionary");
});
