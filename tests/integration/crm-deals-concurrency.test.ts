import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCompany } from "../../src/server/companies";
import { createDeal, createPipeline, createStage, getDeal, listDeals, listPipelines, moveDeal, reorderStages, updateDeal, updatePipeline, updateStage } from "../../src/server/crm-deals";
import { withTenant } from "../../src/server/tenancy";
import { MAX_STAGES, dealQuery, type Pipeline } from "../../src/lib/crm-deals";
import type { Database } from "../../src/db/client";

/**
 * CRM-04 review blockers B1 (restore must respect archived parents) and B2 (concurrent
 * column appends). These need real concurrency, so they run on a pool of many
 * physical connections, not the fixture's single-connection pool.
 */
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let wide: Pool, db: Database, tenant: string, company: string, pipeline: Pipeline;
const query = (value: Record<string, unknown> = {}) => dealQuery.parse(value);
const stage = (item: Pipeline, key: string) => item.stages.find((entry) => entry.key === key)!;
const fresh = async (id: string) => (await listPipelines(db, "owner", tenant, { includeArchived: true })).find((item) => item.id === id)!;

beforeAll(async () => {
  fixture = await testDatabase();
  wide = new Pool({ connectionString: fixture.appURL, max: 10 });
  db = drizzle(wide, { schema }) as unknown as Database;
  await fixture.db.insert(users).values([{ id: "owner", name: "Synthetic owner", email: "owner@example.test" }]);
  tenant = (await createWorkspace(fixture.db, "owner", "Concurrency")).tenantId;
  company = (await createCompany(fixture.db, "owner", tenant, { name: "Synthetic Fellowship" })).id;
  pipeline = (await listPipelines(db, "owner", tenant))[0];
});
afterAll(async () => { await wide?.end(); await fixture?.close(); });

describe("stage -> pipeline lock order", () => {
  it.each(["reorder", "create"] as const)("lets a raw deal restore finish while %s waits on its stage", async (operation) => {
    const other = await createPipeline(db, "owner", tenant, { name: `Lock order ${operation}` });
    // createStage shifts closed stages too; hold Won to cover that update path.
    const target = stage(other, "won");
    const deal = await createDeal(db, "owner", tenant, { name: "Restore contention", companyId: company, pipelineId: other.id, stageId: target.id });
    await updateDeal(db, "owner", tenant, deal.id, { archived: true, version: deal.version });
    let release!: () => void, ready!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<number>((resolve) => { ready = resolve; });
    const restore = withTenant(db, "owner", tenant, "opportunities:write", async (tx) => {
      await tx.execute(sql`select id from crm_pipeline_stages where tenant_id = ${tenant}::uuid and id = ${target.id}::uuid for share`);
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      ready(Number(pid.rows[0].pid));
      await gate;
      // The real 0017 trigger now takes stage -> pipeline FOR SHARE. Before the
      // fix, the other service already owned pipeline and waited on this stage.
      await tx.execute(sql`update opportunities set archived_at = null where tenant_id = ${tenant}::uuid and id = ${deal.id}::uuid`);
    });
    // Attach rejection handlers before releasing either side of the contention.
    let mutation: Promise<unknown> | undefined;
    const outcomes = Promise.allSettled([restore, (async () => {
      const pid = await locked;
      mutation = operation === "reorder"
        ? reorderStages(db, "owner", tenant, other.id, { stageIds: other.stages.map((item) => item.id).reverse() })
        : createStage(db, "owner", tenant, other.id, { name: "Inserted before Won" });
      const result = Promise.allSettled([mutation]);
      try {
        await expect.poll(async () => {
          const waiting = await fixture.admin.query("select count(*)::int as n from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))", [pid]);
          return waiting.rows[0].n;
        }, { timeout: 5_000 }).toBe(1);
      } finally { release(); }
      return (await result)[0];
    })()]);
    try {
      const [restored, changed] = await outcomes;
      expect(restored.status).toBe("fulfilled");
      expect(changed).toMatchObject({ status: "fulfilled", value: { status: "fulfilled" } });
      expect((await getDeal(db, "owner", tenant, deal.id)).deal.archivedAt).toBeNull();
      const after = await fresh(other.id);
      if (operation === "reorder") expect(after.stages.map((item) => item.id)).toEqual(other.stages.map((item) => item.id).reverse());
      else expect(after.stages.findIndex((item) => item.name === "Inserted before Won")).toBeLessThan(after.stages.findIndex((item) => item.id === target.id));
    } finally {
      release();
      await Promise.allSettled([restore, ...(mutation ? [mutation] : [])]);
    }
  });
});

describe("B1: a restored deal never lands under an archived stage or pipeline", () => {
  it("refuses restoring into an archived stage (409) until the stage is restored, then shows it on board and list", async () => {
    const hold = await createStage(db, "owner", tenant, pipeline.id, { name: "On hold", probability: 5 });
    const deal = await createDeal(db, "owner", tenant, { name: "Paused gift", companyId: company, stageId: hold.id, amount: "100" });
    const archived = await updateDeal(db, "owner", tenant, deal.id, { archived: true, version: deal.version });
    const stageArchived = await updateStage(db, "owner", tenant, hold.id, { archived: true, version: hold.version });
    await expect(updateDeal(db, "owner", tenant, deal.id, { archived: false, version: archived.version })).rejects.toMatchObject({ status: 409, details: { reason: "parent_archived" } });
    expect((await getDeal(db, "owner", tenant, deal.id)).deal.archivedAt).not.toBeNull();
    await updateStage(db, "owner", tenant, hold.id, { archived: false, version: stageArchived.version });
    const restored = await updateDeal(db, "owner", tenant, deal.id, { archived: false, version: archived.version });
    expect(restored.version).toBe(archived.version + 1);
    const board = await listDeals(db, "owner", tenant, null, query());
    expect(board.deals.map((item) => item.id)).toContain(deal.id);
    expect(board.stageTotals[hold.id]).toEqual({ count: 1, amount: 100 });
    expect((await listDeals(db, "owner", tenant, null, query({ mode: "list", stage: hold.id }))).deals.map((item) => item.id)).toEqual([deal.id]);
  });
  it("refuses archiving a non-default pipeline with live deals, and restoring into an archived pipeline", async () => {
    let other = await createPipeline(db, "owner", tenant, { name: "Partners" });
    const deal = await createDeal(db, "owner", tenant, { name: "Partner deal", companyId: company, pipelineId: other.id, amount: "250" });
    await expect(updatePipeline(db, "owner", tenant, other.id, { archived: true, version: other.version })).rejects.toMatchObject({ status: 409, details: { reason: "pipeline_has_deals" } });
    const archived = await updateDeal(db, "owner", tenant, deal.id, { archived: true, version: deal.version });
    other = await fresh(other.id);
    const pipelineArchived = await updatePipeline(db, "owner", tenant, other.id, { archived: true, version: other.version });
    await expect(updateDeal(db, "owner", tenant, deal.id, { archived: false, version: archived.version })).rejects.toMatchObject({ status: 409, details: { reason: "parent_archived" } });
    await updatePipeline(db, "owner", tenant, other.id, { archived: false, version: pipelineArchived.version });
    await updateDeal(db, "owner", tenant, deal.id, { archived: false, version: archived.version });
    const board = await listDeals(db, "owner", tenant, other.id, query());
    expect(board.deals.map((item) => item.id)).toEqual([deal.id]);
    expect(board.openTotal).toBe(250);
    expect((await listDeals(db, "owner", tenant, other.id, query({ mode: "list" }))).total).toBe(1);
  });
  it("refuses the same restore through raw SQL, with no service in the way", async () => {
    const hold = await createStage(db, "owner", tenant, pipeline.id, { name: "Raw hold" });
    const deal = await createDeal(db, "owner", tenant, { name: "Raw deal", companyId: company, stageId: hold.id });
    await updateDeal(db, "owner", tenant, deal.id, { archived: true, version: deal.version });
    await updateStage(db, "owner", tenant, hold.id, { archived: true, version: hold.version });
    await expect(withTenant(db, "owner", tenant, "opportunities:write", (tx) => tx.execute(sql`update opportunities set archived_at = null where id = ${deal.id}::uuid`)))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining("restore the stage first") } });
    // Positive control: other edits to the archived deal still pass the guard.
    await expect(withTenant(db, "owner", tenant, "opportunities:write", (tx) => tx.execute(sql`update opportunities set name = 'Raw deal (kept)' where id = ${deal.id}::uuid`))).resolves.toBeDefined();
  });
  it("never leaves a live deal under an archived stage when restore and archive race", async () => {
    for (let round = 0; round < 12; round += 1) {
      const hold = await createStage(db, "owner", tenant, pipeline.id, { name: `Race ${round}` });
      const deal = await createDeal(db, "owner", tenant, { name: `Race deal ${round}`, companyId: company, stageId: hold.id });
      const archived = await updateDeal(db, "owner", tenant, deal.id, { archived: true, version: deal.version });
      const [restore, archive] = await Promise.allSettled([
        updateDeal(db, "owner", tenant, deal.id, { archived: false, version: archived.version }),
        updateStage(db, "owner", tenant, hold.id, { archived: true, version: hold.version }),
      ]);
      // Exactly one side wins; the loser gets a 409, never a broken state.
      expect([restore.status, archive.status].filter((status) => status === "fulfilled")).toHaveLength(1);
      for (const result of [restore, archive]) if (result.status === "rejected") expect(result.reason).toMatchObject({ status: 409 });
      // Leave the pipeline tidy for the next round.
      if (archive.status === "rejected") {
        const live = await getDeal(db, "owner", tenant, deal.id);
        await updateDeal(db, "owner", tenant, deal.id, { archived: true, version: live.deal.version });
        await updateStage(db, "owner", tenant, hold.id, { archived: true, version: (await fresh(pipeline.id)).stages.find((item) => item.id === hold.id)!.version });
      }
    }
    const broken = await fixture.admin.query(`select count(*)::int as n from opportunities o join crm_pipeline_stages s on s.tenant_id = o.tenant_id and s.id = o.stage_id
      join crm_pipelines p on p.tenant_id = o.tenant_id and p.id = o.pipeline_id where o.archived_at is null and (s.archived_at is not null or p.archived_at is not null)`);
    expect(broken.rows[0].n).toBe(0);
  });
  it("applies the 20-stage limit when restoring a stage, as when creating one", async () => {
    let other = await createPipeline(db, "owner", tenant, { name: "Many stages" });
    const spare = await createStage(db, "owner", tenant, other.id, { name: "Spare" });
    const archivedSpare = await updateStage(db, "owner", tenant, spare.id, { archived: true, version: spare.version });
    other = await fresh(other.id);
    for (let index = other.stages.filter((item) => !item.archivedAt).length; index < MAX_STAGES; index += 1) await createStage(db, "owner", tenant, other.id, { name: `Filler ${index}` });
    await expect(createStage(db, "owner", tenant, other.id, { name: "One too many" })).rejects.toMatchObject({ status: 409 });
    await expect(updateStage(db, "owner", tenant, spare.id, { archived: false, version: archivedSpare.version })).rejects.toMatchObject({ status: 409 });
  });
});

describe("B2: concurrent appends to one column get distinct, ordered positions", () => {
  it("gives eight deals moved into the same stage at once eight distinct positions, kept after reload", async () => {
    const [source, target] = [stage(pipeline, "new"), stage(pipeline, "contacted")];
    const deals = [];
    for (let index = 0; index < 8; index += 1) deals.push(await createDeal(db, "owner", tenant, { name: `Mover ${index}`, companyId: company, stageId: source.id }));
    const results = await Promise.all(deals.map((deal) => moveDeal(db, "owner", tenant, deal.id, { stageId: target.id, version: deal.version })));
    expect(results.every((result) => result.stageId === target.id)).toBe(true);
    const rows = await fixture.admin.query("select id, position from opportunities where tenant_id = $1 and stage_id = $2 and archived_at is null", [tenant, target.id]);
    const positions = rows.rows.map((row) => Number(row.position));
    expect(new Set(positions).size).toBe(positions.length);
    // "Reload": the board reads the column back in position order, every mover present once.
    const board = await listDeals(db, "owner", tenant, null, query({ stage: target.id }));
    expect(board.deals.map((item) => item.position)).toEqual([...board.deals.map((item) => item.position)].sort((a, b) => a - b));
    expect(new Set(board.deals.map((item) => item.id)).size).toBe(board.deals.length);
    expect(board.deals.filter((item) => item.name.startsWith("Mover"))).toHaveLength(8);
  });
  it("gives concurrently created deals in one stage distinct positions too", async () => {
    const target = stage(pipeline, "qualified");
    await Promise.all(Array.from({ length: 8 }, (_, index) => createDeal(db, "owner", tenant, { name: `Creator ${index}`, companyId: company, stageId: target.id })));
    const rows = await fixture.admin.query("select position from opportunities where tenant_id = $1 and stage_id = $2", [tenant, target.id]);
    expect(new Set(rows.rows.map((row) => Number(row.position))).size).toBe(rows.rows.length);
  });
  it("still lets only one of two racing moves of the same deal win; the other gets 409", async () => {
    const deal = await createDeal(db, "owner", tenant, { name: "Contested", companyId: company, stageId: stage(pipeline, "new").id });
    const outcomes = await Promise.allSettled([
      moveDeal(db, "owner", tenant, deal.id, { stageId: stage(pipeline, "contacted").id, version: deal.version }),
      moveDeal(db, "owner", tenant, deal.id, { stageId: stage(pipeline, "qualified").id, version: deal.version }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: { status: 409, details: { reason: "stale" } } });
    const moves = await fixture.admin.query("select count(*)::int as n from audit_logs where target_id = $1 and action = 'opportunity.move'", [deal.id]);
    expect(moves.rows[0].n).toBe(1);
  });
});
