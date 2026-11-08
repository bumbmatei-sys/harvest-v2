import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink, resolveConnectLink } from "../../src/server/connect-links";
import { getLanding, writeLanding, resolvePublishedLanding } from "../../src/server/connect-landing";
import { withTenant } from "../../src/server/tenancy";
import type { LandingDefinition } from "../../src/lib/connect-landing";
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string, campaign: string;
const definition: LandingDefinition = { heading: "Welcome <friends>", message: "Free resources for everyone\nOptional next steps", cards: [
  { kind: "resource", resourceId: "common-questions" }, { kind: "external", category: "course", title: "Optional course", description: "An external offer", url: "https://example.org/course", price: "paid" },
] };
const create = () => createConnectLink(f.db, "owner", tenant, campaign, {});
const save = (l: { id: string; publicCode: string }, revision = 0, d = definition, user = "member") => writeLanding(f.db, user, tenant, campaign, l.id, { definition: d, expectedRevision: revision, expectedCode: l.publicCode });
const publish = (l: { id: string; publicCode: string }, revision: number, user = "owner") => writeLanding(f.db, user, tenant, campaign, l.id, { expectedRevision: revision, expectedCode: l.publicCode }, true);
const as = <T>(run: Parameters<typeof withTenant<T>>[4], user = "owner") => withTenant(f.db, user, tenant, "workspace:read", run);
beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(schema.users).values(["owner", "admin", "member", "viewer", "other"].map(id => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(f.db, "owner", "Landing A")).tenantId; other = (await createWorkspace(f.db, "other", "Landing B")).tenantId;
  for (const role of ["admin", "member", "viewer"]) await putMember(f.db, "owner", tenant, `${role}@example.test`, role as "admin" | "member" | "viewer");
  campaign = (await createCampaign(f.db, "owner", tenant, { name: "Synthetic landing", type: "conference" }, "landing-a")).id;
});
afterAll(async () => { await f?.close(); });
it("FORCE RLS, no direct application writes, private drafts and live role/parent checks", async () => {
  const l = await create(); expect(await getLanding(f.db, "member", tenant, campaign, l.id)).toMatchObject({ revision: 0, published: null, permissions: { edit: true, publish: false } });
  for (const table of ["connect_landing_states", "connect_landing_versions"]) {
    expect((await f.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where relname=$1", [table])).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await f.admin.query("select has_table_privilege('harvest_app',$1,'INSERT,UPDATE,DELETE,TRUNCATE') as writes", [table])).rows[0].writes).toBe(false);
  }
  await save(l);
  await expect(getLanding(f.db, "other", tenant, campaign, l.id)).rejects.toMatchObject({ status: 403 });
  await expect(getLanding(f.db, "owner", other, campaign, l.id)).rejects.toMatchObject({ status: 403 });
  await expect(getLanding(f.db, "viewer", tenant, campaign, l.id)).rejects.toMatchObject({ status: 403 });
  await expect(writeLanding(f.db, "owner", tenant, randomUUID(), l.id, { expectedRevision: 1, expectedCode: l.publicCode }, true)).rejects.toMatchObject({ status: 404 });
  await expect(publish(l, 1, "member")).rejects.toMatchObject({ status: 403 });
  expect(await resolvePublishedLanding(f.db, "qr", l.publicCode)).toBeUndefined();
  await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "publish" });
  expect(await resolvePublishedLanding(f.db, "qr", l.publicCode)).toMatchObject({ definition: undefined });
  // Changing a real role revokes direct function execution, even if the caller sets tenant GUCs.
  await putMember(f.db, "owner", tenant, "admin@example.test", "viewer");
  await expect(as(tx => tx.execute(sql`select public.connect_landing_write(${tenant}::uuid,${campaign}::uuid,${l.id}::uuid,1,${l.publicCode},null,true)`), "admin")).rejects.toThrow();
  await putMember(f.db, "owner", tenant, "admin@example.test", "admin");
  await as(async tx => { expect((await tx.execute(sql`select * from public.connect_landing_states where tenant_id=${other}::uuid`)).rows).toEqual([]); });
});
it("publishes immutable snapshots idempotently without activating a draft QR or changing expiry", async () => {
  const l = await create(); await save(l); await publish(l, 1); await publish(l, 1, "admin");
  expect((await f.admin.query("select status,expires_at from campaign_response_links where id=$1", [l.id])).rows[0]).toEqual({ status: "draft", expires_at: null });
  expect(await resolvePublishedLanding(f.db, "short", l.shortCode)).toBeUndefined();
  await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "publish" });
  for (const [kind, code] of [["qr", l.publicCode], ["short", l.shortCode]] as const) {
    expect(await resolvePublishedLanding(f.db, kind, code)).toMatchObject({ definition });
    expect(await resolveConnectLink(f.db, kind, code)).toEqual({ locale: "en", title: null });
    const result = await f.db.execute(sql`select * from public.resolve_connect_landing(${kind},${code})`);
    expect(Object.keys(result.rows[0]).sort()).toEqual(["definition", "locale", "public_title"]);
  }
  await save(l, 1, { ...definition, heading: "Private next draft" });
  expect((await resolvePublishedLanding(f.db, "qr", l.publicCode))?.definition?.heading).toBe(definition.heading);
  await expect(publish(l, 1)).rejects.toMatchObject({ status: 409 });
  await publish(l, 2);
  expect((await resolvePublishedLanding(f.db, "short", l.shortCode))?.definition?.heading).toBe("Private next draft");
  expect((await f.admin.query("select count(*)::int as n from connect_landing_versions where link_id=$1", [l.id])).rows[0].n).toBe(2);
  await expect(f.admin.query("update connect_landing_versions set definition=definition where link_id=$1", [l.id])).rejects.toThrow("immutable");
  await expect(f.admin.query("delete from connect_landing_versions where link_id=$1", [l.id])).rejects.toThrow("immutable");
  await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "disable" });
  await save(l, 2); await publish(l, 3);
  expect(await resolvePublishedLanding(f.db, "qr", l.publicCode)).toBeUndefined();
  expect((await f.admin.query("select status from campaign_response_links where id=$1", [l.id])).rows[0].status).toBe("disabled");
});
it("rejects unsafe definitions at the database boundary, including JSON null/type tricks", async () => {
  const l = await create();
  const invalid = [null, {}, { ...definition, heading: null }, { ...definition, cards: [{ kind: "resource", resourceId: null }] },
    { ...definition, cards: [{ kind: "external", category: null, title: "x", description: "", url: "https://example.org", price: "free" }] },
    ...["http://example.org", "https://user@example.org", "https://localhost", "https://a.localhost", "https://127.0.0.1", "https://[::1]", "https://2130706433", "https://0x7f000001", "https://example.org\\x", "https://example.org:65536"].map(url => ({ ...definition, cards: [{ ...definition.cards[1], url }] })),
    { ...definition, cards: [{ ...definition.cards[1], category: "community", price: "paid" }] }, { ...definition, cards: Array(9).fill(definition.cards[0]) }, { ...definition, consent: true }];
  await as(async tx => { for (const d of invalid) {
    const r = await tx.execute(sql`select public.connect_landing_write(${tenant}::uuid,${campaign}::uuid,${l.id}::uuid,0,${l.publicCode},${JSON.stringify(d)}::jsonb,false) as outcome`);
    expect(r.rows[0], JSON.stringify(d)).toEqual({ outcome: "invalid" });
  } });
});
it("stale concurrent saves, code rotation, link/campaign archive and expiry remain authoritative", async () => {
  const l = await create();
  const outcomes = await Promise.allSettled([save(l), save(l)]);
  expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(x => x.status === "rejected").map(x => (x as PromiseRejectedResult).reason.status)).toEqual([409]);
  await publish(l, 1);
  const rotated = (await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "rotate", expectedCode: l.publicCode })).link;
  await expect(save(l, 1)).rejects.toMatchObject({ status: 409 }); await expect(publish(l, 1)).rejects.toMatchObject({ status: 409 });
  expect(await resolvePublishedLanding(f.db, "qr", l.publicCode)).toBeUndefined(); expect(await resolvePublishedLanding(f.db, "short", l.shortCode)).toBeUndefined();
  await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "publish", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await save(rotated, 1); await publish(rotated, 2);
  // Time passes without updating or extending the link.
  await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "publish", expiresAt: new Date(Date.now() + 200).toISOString() });
  await new Promise(r => setTimeout(r, 250));
  expect(await resolvePublishedLanding(f.db, "qr", rotated.publicCode)).toBeUndefined();
  await save(rotated, 2); await publish(rotated, 3);
  expect(await resolvePublishedLanding(f.db, "short", rotated.shortCode)).toBeUndefined();
  await transitionConnectLink(f.db, "owner", tenant, campaign, l.id, { action: "archive" });
  await expect(save(rotated, 3)).rejects.toMatchObject({ status: 409 }); await expect(publish(rotated, 3)).rejects.toMatchObject({ status: 409 });
});
// Independent physical connections prove the database lock/recheck contract, not just service preflight.
it.each(["rotate", "archive", "campaign archive", "role downgrade"].flatMap(action => [true, false].map(publishing => ({ action, publishing }))))("rechecks after concurrent $action wins the lock (publish=$publishing)", async ({ action, publishing }) => {
  const c = (await createCampaign(f.db, "owner", tenant, { name: action, type: "conference" }, randomUUID())).id;
  const l = await createConnectLink(f.db, "owner", tenant, c, {});
  await writeLanding(f.db, "member", tenant, c, l.id, { definition, expectedRevision: 0, expectedCode: l.publicCode });
  const admin = await f.admin.connect(); const pool = new Pool({ connectionString: f.appURL, max: 1 });
  try {
    await admin.query("begin");
    if (action === "campaign archive") await admin.query("update campaigns set archived_at=now() where tenant_id=$1 and id=$2", [tenant, c]);
    else if (action === "role downgrade") await admin.query("update workspace_members set role_id='viewer' where tenant_id=$1 and user_id='admin'", [tenant]);
    else {
      await admin.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id','owner',true)", [tenant]);
      await admin.query("select public.connect_link_transition($1,$2,$3,null,$4)", [tenant, l.id, action, l.publicCode]);
    }
    const pending = writeLanding(drizzle(pool, { schema }), action === "role downgrade" ? "admin" : "owner", tenant, c, l.id, { expectedRevision: 1, expectedCode: l.publicCode, ...(!publishing ? { definition } : {}) }, publishing)
      .then(value => ({ value, status: 200 }), error => ({ status: error.status }));
    // Ensure the operation actually waits on the competing transaction.
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      await admin.query("select pg_stat_clear_snapshot()");
      const result = await admin.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()");
      if (result.rowCount) { waiting = true; break; } await new Promise(r => setTimeout(r, 10));
    }
    expect(waiting).toBe(true); await admin.query("commit");
    expect((await pending).status).toBe(action === "role downgrade" ? 403 : 409);
    expect((await admin.query("select count(*)::int as n from connect_landing_versions where link_id=$1", [l.id])).rows[0].n).toBe(0);
  } finally { await admin.query("rollback"); admin.release(); await pool.end(); if (action === "role downgrade") await putMember(f.db, "owner", tenant, "admin@example.test", "admin"); }
});

it("concurrent duplicate publications create one snapshot and one publication audit", async () => {
  const l = await create(); await save(l);
  const pool = new Pool({ connectionString: f.appURL, max: 2 }), db = drizzle(pool, { schema });
  try {
    const results = await Promise.all([1, 2].map(() => writeLanding(db, "owner", tenant, campaign, l.id, { expectedRevision: 1, expectedCode: l.publicCode }, true)));
    expect(results.map(r => r.outcome).sort()).toEqual(["published", "unchanged"]);
    expect((await f.admin.query("select count(*)::int as n from connect_landing_versions where link_id=$1", [l.id])).rows[0].n).toBe(1);
    expect((await f.admin.query("select count(*)::int as n from audit_logs where target_id=$1 and action='connect.landing.publish'", [l.id])).rows[0].n).toBe(1);
  } finally { await pool.end(); }
});
it("cross-tenant drafts and QR publication pointers are isolated by composite references", async () => {
  const c = (await createCampaign(f.db, "other", other, { name: "Other campaign", type: "conference" }, randomUUID())).id;
  const l = await createConnectLink(f.db, "other", other, c, {});
  await writeLanding(f.db, "other", other, c, l.id, { definition, expectedRevision: 0, expectedCode: l.publicCode });
  await as(async tx => {
    expect((await tx.execute(sql`select * from connect_landing_states where tenant_id=${other}::uuid`)).rows).toEqual([]);
    await expect(tx.execute(sql`select public.connect_landing_write(${other}::uuid,${c}::uuid,${l.id}::uuid,1,${l.publicCode},null,true)`)).rejects.toThrow();
  });
  const a = await create(), b = await create(); await save(a); await publish(a, 1); await save(b);
  await expect(as(tx => tx.execute(sql`update connect_landing_states set published_revision=1 where link_id=${b.id}::uuid`))).rejects.toThrow();
  // Even the trusted owner cannot make a QR point at a different QR's snapshot.
  await expect(f.admin.query("update connect_landing_states set published_revision=1 where tenant_id=$1 and link_id=$2", [tenant, b.id])).rejects.toThrow();
});
