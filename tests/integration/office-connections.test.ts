import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { seedPeople, useTestKeys } from "./social-layer-fixture";
import { FakeMailProvider } from "../../src/server/mail/fake-provider";
import { linkOfficeConnection, listOfficeConnections } from "../../src/server/office-provider/connections";
import { useKeyProvider } from "../../src/server/connect-key-provider";
vi.mock("server-only", () => ({}));
import { openCredential, credentialBinding } from "../../src/server/social/credential-envelope";
import { withUser, withTenant } from "../../src/server/tenancy";
let f: Awaited<ReturnType<typeof testDatabase>>, people: Awaited<ReturnType<typeof seedPeople>>;
const deps = { enabled: true, provider: new FakeMailProvider() };
beforeAll(async () => { f = await testDatabase({ migrationOwner: true }); useTestKeys(); people = await seedPeople(f, "office"); }, 90000);
afterAll(async () => { useKeyProvider(null); await f?.close(); });
it("personal RLS: each admin sees only own connections; tenant/member/viewer isolation", async () => {
  const input = { kind: "mail", provider: "fake", accountRef: "account-1", credential: "fake-credential" };
  await linkOfficeConnection(f.db, people.owner, people.tenant, input, deps);
  expect(await listOfficeConnections(f.db, people.admin, people.tenant, deps)).toEqual([]);
  await linkOfficeConnection(f.db, people.admin, people.tenant, { ...input, kind: "calendar" }, deps);
  expect(await listOfficeConnections(f.db, people.owner, people.tenant, deps)).toHaveLength(1);
  for (const user of [people.member,people.viewer,people.outsider]) { await expect(listOfficeConnections(f.db, user, people.tenant, deps)).rejects.toMatchObject({ status: 403 }); await expect(linkOfficeConnection(f.db, user, people.tenant, input, deps)).rejects.toMatchObject({ status: 403 }); }
  const rows = await withTenant(f.db, people.admin, people.tenant, "social:connect", tx => tx.execute(sql`select owner_user_id from public.office_connections`)); expect(rows.rows).toEqual([{ owner_user_id: people.admin }]);
  expect(await listOfficeConnections(f.db, people.outsider, people.other, deps)).toEqual([]);
});
it("envelope only, bound to row; no plaintext, immutable owner, force RLS", async () => {
  const rows = await f.admin.query("select credential_envelope from public.office_connections"); expect(JSON.stringify(rows.rows)).not.toContain("fake-credential");
  const forced = await f.admin.query("select relforcerowsecurity from pg_class where oid='public.office_connections'::regclass"); expect(forced.rows[0].relforcerowsecurity).toBe(true);
  await expect(withTenant(f.db, people.owner, people.tenant, "social:connect", tx => tx.execute(sql`update public.office_connections set owner_user_id=${people.admin}`))).rejects.toBeTruthy();
});
it("kill switch refuses before DB/provider and no network call", async () => { const spy = vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN")); try { await expect(linkOfficeConnection(f.db, people.owner, people.tenant, {}, undefined)).rejects.toMatchObject({ status: 404 }); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); } });

it("raw application SQL cannot bypass personal RLS or role downgrade", async () => {
  for (const user of [people.member, people.viewer, people.outsider]) {
    const rows = await withUser(f.db, user, async tx => { await tx.execute(sql`select set_config('app.tenant_id', ${people.tenant}, true)`); return tx.execute(sql`select id from public.office_connections`); });
    expect(rows.rows).toEqual([]);
    await expect(withUser(f.db, user, async tx => { await tx.execute(sql`select set_config('app.tenant_id', ${people.tenant}, true)`); return tx.execute(sql`insert into public.office_connections(tenant_id,owner_user_id,kind,provider,external_account_ref,credential_envelope) select ${people.tenant}::uuid,${user},'files','fake','x',jsonb_build_object('version',1,'keyId','x','binding','x','iv','x','tag','x','ciphertext','x')`); })).rejects.toBeTruthy();
  }
  await expect(withTenant(f.db, people.admin, people.tenant, "social:connect", tx => tx.execute(sql`insert into public.office_connections(tenant_id,owner_user_id,kind,provider,external_account_ref,credential_envelope) select tenant_id,${people.owner},'files',provider,external_account_ref,credential_envelope from public.office_connections`))).rejects.toBeTruthy();
  await f.admin.query("update workspace_members set role_id='member' where tenant_id=$1 and user_id=$2", [people.tenant,people.admin]);
  const rows = await withUser(f.db, people.admin, async tx => { await tx.execute(sql`select set_config('app.tenant_id', ${people.tenant}, true)`); return tx.execute(sql`select id from public.office_connections`); }); expect(rows.rows).toEqual([]);
});
it("stored envelope opens only for its own ministry and connection", async () => {
  const { rows: [row] } = await f.admin.query("select tenant_id,id,credential_envelope from public.office_connections limit 1");
  expect(openCredential(row.credential_envelope,credentialBinding(row.tenant_id,row.id)).secret).toBe("fake-credential");
  expect(() => openCredential(row.credential_envelope,credentialBinding(people.other,row.id))).toThrow();
});
