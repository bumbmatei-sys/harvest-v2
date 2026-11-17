import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { seedPeople } from "./social-layer-fixture";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { getCampaignConnectMetrics, metricKeys } from "../../src/server/connect-metrics";
import { withUser } from "../../src/server/tenancy";

// Fixed local workload only. No URL/environment target option, HTTP driver or provider client.
const WORKERS = 8, PER_WORKER = 25;
let f: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let pool: Pool;
let network: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  const role = (await f.admin.query("select rolsuper,rolbypassrls from pg_roles where rolname=$1", [f.migrationOwner])).rows[0];
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  people = await seedPeople(f, "hc16");
  // Stall guards bound failed assertions/lock probes; these are not product latency budgets.
  await f.pool.query("set statement_timeout = '15s'");
  pool = new Pool({ connectionString: f.appURL, max: WORKERS, statement_timeout: 15_000 });
  network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN"));
}, 90000);
afterAll(async () => {
  try { if (network) expect(network).not.toHaveBeenCalled(); } finally { network?.mockRestore(); await pool?.end(); await f?.close(); }
});

async function campaign(other = false) {
  const owner = other ? people.outsider : people.owner, tenant = other ? people.other : people.tenant;
  const id = (await createCampaign(f.db, owner, tenant, { name: "Synthetic HC-16", type: "conference" }, randomUUID())).id;
  const link = await createConnectLink(f.db, owner, tenant, id, {});
  await transitionConnectLink(f.db, owner, tenant, id, link.id, { action: "publish" });
  return { owner, tenant, id, link };
}
async function capture(client: PoolClient, code: string, enabled = true, tenantHint?: string) {
  await client.query("BEGIN");
  try {
    if (enabled) await client.query("select set_config('app.connect_intake_mode','synthetic',true)");
    if (tenantHint) await client.query("select set_config('app.tenant_id',$1,true)", [tenantHint]);
    const { rows: [row] } = await client.query<{ counted: boolean }>("select public.connect_record_scan('qr',$1) as counted", [code]);
    await client.query("COMMIT"); return row.counted;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
async function scans(tenant: string, id: string) {
  return (await f.admin.query("select coalesce(sum(count),0)::int as n from campaign_scan_days where tenant_id=$1 and campaign_id=$2", [tenant, id])).rows[0].n as number;
}

it("eight physical application connections retain every concurrent increment in two ministries", async () => {
  const a = await campaign(), b = await campaign(true);
  const clients = await Promise.all(Array.from({ length: WORKERS }, () => pool.connect()));
  const times: number[] = [];
  try {
    const pids = await Promise.all(clients.map(async client => (await client.query("select pg_backend_pid() as pid")).rows[0].pid));
    expect(new Set(pids).size).toBe(WORKERS);
    const started = performance.now();
    const outcomes = await Promise.allSettled(clients.map(async (client, worker) => {
      for (let i = 0; i < PER_WORKER; i++) {
        const at = performance.now();
        expect(await capture(client, worker % 2 ? b.link.publicCode : a.link.publicCode)).toBe(true);
        times.push(performance.now() - at);
      }
    }));
    const failures = outcomes.filter(result => result.status === "rejected");
    expect(failures).toEqual([]);
    const elapsedMs = performance.now() - started;
    expect(times).toHaveLength(WORKERS * PER_WORKER);
    expect(await scans(a.tenant, a.id)).toBe(100); expect(await scans(b.tenant, b.id)).toBe(100);
    expect((await getCampaignConnectMetrics(f.db, a.owner, a.tenant, a.id)).metrics.scans).toBe(100);
    expect((await getCampaignConnectMetrics(f.db, b.owner, b.tenant, b.id)).metrics.scans).toBe(100);
    const sorted = times.sort((x, y) => x - y);
    // Counts and timings only; no URL, credential, code, tenant or contact identifiers.
    const observation = { workload: "hc16-local-scan-burst", connections: WORKERS, operations: times.length,
      elapsedMs: Math.round(elapsedMs), p50Ms: Math.round(sorted[Math.ceil(sorted.length * .5) - 1]),
      p95Ms: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]), maxMs: Math.round(sorted.at(-1)!) };
    const evidence = await mkdtemp(join(tmpdir(), "hc16-local-evidence-"));
    await writeFile(join(evidence, "scan-burst.json"), JSON.stringify(observation, null, 2) + "\n");
    console.info(JSON.stringify(observation));
  } finally { clients.forEach(client => client.release()); }
}, 90000);

it("invalid and disabled capture bursts do not create counters, even after pooled synthetic transactions", async () => {
  const target = await campaign();
  const clients = await Promise.all(Array.from({ length: WORKERS }, () => pool.connect()));
  try {
    const outcomes = await Promise.allSettled(clients.map(async client => {
      for (let i = 0; i < 10; i++) {
        expect(await capture(client, "unknown-synthetic-code")).toBe(false);
        expect(await capture(client, target.link.publicCode, false)).toBe(false);
      }
    }));
    expect(outcomes.filter(result => result.status === "rejected")).toEqual([]);
    expect(await scans(target.tenant, target.id)).toBe(0);
    expect((await f.admin.query("select count(*)::int as n from campaign_scan_days where campaign_id=$1", [target.id])).rows[0].n).toBe(0);
  } finally { clients.forEach(client => client.release()); }
}, 90000);

it("code ownership overrides a forged tenant hint and pool reuse leaks no tenant/user/mode context", async () => {
  const a = await campaign(), b = await campaign(true), client = await pool.connect();
  try {
    for (let i = 0; i < 5; i++) expect(await capture(client, b.link.publicCode, true, a.tenant)).toBe(true);
    expect(await scans(a.tenant, a.id)).toBe(0); expect(await scans(b.tenant, b.id)).toBe(5);
    const { rows: [context] } = await client.query("select nullif(current_setting('app.tenant_id',true),'') as tenant, nullif(current_setting('app.user_id',true),'') as actor, nullif(current_setting('app.connect_intake_mode',true),'') as mode");
    expect(context).toEqual({ tenant: null, actor: null, mode: null });
    expect(await capture(client, b.link.publicCode, false)).toBe(false);
  } finally { client.release(); }
});

it("a metrics read sees committed counters while another connection holds an increment transaction", async () => {
  const target = await campaign();
  const writer = await pool.connect();
  try {
    for (let i = 0; i < 5; i++) await capture(writer, target.link.publicCode);
    await writer.query("BEGIN");
    try {
      await writer.query("select set_config('app.connect_intake_mode','synthetic',true)");
      for (let i = 0; i < 5; i++) await writer.query("select public.connect_record_scan('qr',$1)", [target.link.publicCode]);
      const before = await getCampaignConnectMetrics(f.db, target.owner, target.tenant, target.id);
      expect(before.metrics.scans).toBe(5);
      expect(Object.keys(before.metrics).sort()).toEqual([...metricKeys].sort());
      await writer.query("COMMIT");
    } catch (error) { await writer.query("ROLLBACK"); throw error; }
    expect((await getCampaignConnectMetrics(f.db, target.owner, target.tenant, target.id)).metrics.scans).toBe(10);
  } finally { writer.release(); }
}, 90000);

it("interleaved authorized and denied reads keep service and raw-SQL role/tenant boundaries", async () => {
  const target = await campaign();
  for (let i = 0; i < 12; i++) {
    await expect(getCampaignConnectMetrics(f.db, people.member, target.tenant, target.id)).rejects.toMatchObject({ status: 403 });
    await expect(getCampaignConnectMetrics(f.db, people.viewer, target.tenant, target.id)).rejects.toMatchObject({ status: 403 });
    await expect(getCampaignConnectMetrics(f.db, people.outsider, people.other, target.id)).rejects.toMatchObject({ status: 404 });
    await expect(withUser(f.db, people.member, async tx => {
      await tx.execute(sql`select set_config('app.tenant_id',${target.tenant},true)`);
      return tx.execute(sql`select public.connect_campaign_metrics(${target.tenant}::uuid,${target.id}::uuid)`);
    })).rejects.toBeTruthy();
    expect((await getCampaignConnectMetrics(f.db, target.owner, target.tenant, target.id)).metrics.scans).toBe(0);
  }
});
