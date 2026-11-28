import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { users } from "../../src/db/schema";
import { acceptChurchLink, churchNetworkSummary, listChurchLinks, requestChurchLink, unlinkChurch } from "../../src/server/church-network";
import { createContact, getContact } from "../../src/server/contacts";
import { withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const parentOwner = "network-parent", childOwner = "network-child", childAdmin = "network-admin";
let f: Awaited<ReturnType<typeof testDatabase>>, parent: string, child: string, contactId: string;

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([parentOwner, childOwner, childAdmin].map(id => ({ id, name: id, email: `${id}@example.invalid` })));
  parent = (await createWorkspace(f.db, parentOwner, "Parent fixture", "church")).tenantId;
  child = (await createWorkspace(f.db, childOwner, "Child fixture", "church")).tenantId;
  await f.admin.query("insert into workspace_members (tenant_id, user_id, role_id) values ($1, $2, 'admin')", [child, childAdmin]);
  contactId = (await createContact(f.db, childOwner, child, { name: "Private Synthetic Contact", email: "private@example.invalid" })).id;
  await f.admin.query(`insert into campaigns (tenant_id, owner_user_id, type, status, name, idempotency_key, fingerprint) values
    ($1, $2, 'local_outreach', 'active', 'Child outreach', 'network-a', repeat('a', 64)),
    ($1, $2, 'local_outreach', 'draft', 'Child draft', 'network-b', repeat('b', 64)),
    ($1, $2, 'conference', 'active', 'Child conference', 'network-c', repeat('c', 64))`, [child, childOwner]);
}, 120_000);
afterAll(async () => { await f?.close(); });

it("requires explicit acceptance from the child owner and shares only the fixed aggregate", async () => {
  const link = await requestChurchLink(f.db, parentOwner, parent, { childId: child });
  expect(link).toEqual({ id: expect.any(String), parentId: parent, childId: child, status: "pending" });
  expect(await requestChurchLink(f.db, parentOwner, parent, { childId: child })).toEqual(link);
  expect(await listChurchLinks(f.db, childOwner, child)).toEqual({ links: [link] });
  await expect(churchNetworkSummary(f.db, parentOwner, parent, link.id)).rejects.toMatchObject({ status: 404 });
  await expect(acceptChurchLink(f.db, childAdmin, child, link.id, { accept: true })).rejects.toMatchObject({ status: 404 });
  await expect(acceptChurchLink(f.db, parentOwner, parent, link.id, { accept: true })).rejects.toMatchObject({ status: 404 });
  expect(() => acceptChurchLink(f.db, childOwner, child, link.id, { accept: false })).toThrow();
  await expect(acceptChurchLink(f.db, childOwner, child, link.id, { accept: true })).resolves.toMatchObject({ status: "linked" });
  expect(await churchNetworkSummary(f.db, parentOwner, parent, link.id)).toEqual({ ...link, status: "linked", activeOutreachCampaigns: 1 });
  await expect(churchNetworkSummary(f.db, childOwner, child, link.id)).rejects.toMatchObject({ status: 404 });
  await expect(getContact(f.db, parentOwner, child, contactId)).rejects.toMatchObject({ status: 403 });
  const direct = await withUser(f.db, parentOwner, async tx => {
    await tx.execute(sql`select set_config('app.church_network_child', ${child}, true)`);
    return tx.execute(sql`select id from public.contacts where tenant_id = ${child}`);
  });
  expect(direct.rows).toEqual([]);
  await expect(f.workerPool.query("select * from public.church_network_links")).rejects.toMatchObject({ code: "42501" });

  await expect(unlinkChurch(f.db, childOwner, child, link.id)).resolves.toMatchObject({ status: "unlinked" });
  await expect(churchNetworkSummary(f.db, parentOwner, parent, link.id)).rejects.toMatchObject({ status: 404 });
  expect(await listChurchLinks(f.db, parentOwner, parent)).toEqual({ links: [] });
  expect((await f.admin.query("select unlinked_by, unlinked_at from church_network_links where id = $1", [link.id])).rows)
    .toEqual([{ unlinked_by: childOwner, unlinked_at: expect.any(Date) }]);

  const next = await requestChurchLink(f.db, parentOwner, parent, { childId: child });
  expect(next.id).not.toBe(link.id);
  await acceptChurchLink(f.db, childOwner, child, next.id, { accept: true });
  await unlinkChurch(f.db, parentOwner, parent, next.id);
  await expect(churchNetworkSummary(f.db, parentOwner, parent, next.id)).rejects.toMatchObject({ status: 404 });
});
