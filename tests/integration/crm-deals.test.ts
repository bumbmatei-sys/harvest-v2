import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { crmPipelineStages, crmPipelines, opportunities, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact } from "../../src/server/contacts";
import { createCompany } from "../../src/server/companies";
import { createDeal, createPipeline, createStage, getDeal, listDeals, listPipelines, listRelatedDeals, moveDeal, reorderStages, updateDeal, updatePipeline, updateStage } from "../../src/server/crm-deals";
import { withTenant } from "../../src/server/tenancy";
import { crmToday, dealQuery, type Pipeline } from "../../src/lib/crm-deals";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, personA: string, companyA: string, companyB: string, pipelineA: Pipeline, pipelineB: Pipeline;
const later = (fn: () => unknown) => Promise.resolve().then(fn);
const query = (value: Record<string, unknown> = {}) => dealQuery.parse(value);
const stage = (pipeline: Pipeline, key: string) => pipeline.stages.find((item) => item.key === key)!;
const daysFromToday = (days: number) => { const date = new Date(`${crmToday()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "viewer-a", "owner-b", "outsider"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Deals A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Deals B")).tenantId;
  for (const [email, role] of [["admin-a", "admin"], ["member-a", "member"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${email}@example.test`, role);
  personA = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Lydia" })).id;
  companyA = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Thyatira Cloth" })).id;
  companyB = (await createCompany(fixture.db, "owner-b", tenantB, { name: "Philippi Trade" })).id;
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-04 schema and RLS", () => {
  it("forces RLS on every new table and shows nothing without tenant context", async () => {
    const { rows } = await fixture.admin.query("select relname, relforcerowsecurity from pg_class where relname in ('crm_pipelines','crm_pipeline_stages','opportunities') order by relname");
    expect(rows.map((row) => [row.relname, row.relforcerowsecurity])).toEqual([["crm_pipeline_stages", true], ["crm_pipelines", true], ["opportunities", true]]);
    for (const table of [crmPipelines, crmPipelineStages, opportunities]) expect(await fixture.db.select().from(table)).toEqual([]);
  });
});

describe("pipelines and stages", () => {
  it("seeds one default pipeline lazily, once, and only for writers", async () => {
    expect(await listPipelines(fixture.db, "viewer-a", tenantA)).toEqual([]);
    const [first, second] = await Promise.all([listPipelines(fixture.db, "member-a", tenantA), listPipelines(fixture.db, "owner-a", tenantA)]);
    expect(first).toHaveLength(1); expect(second).toHaveLength(1);
    pipelineA = first[0];
    expect(pipelineA).toMatchObject({ name: "Pipeline", isDefault: true });
    expect(pipelineA.stages.map((item) => [item.key, item.name, item.kind, item.probability])).toEqual([
      ["new", "New", "open", 10], ["contacted", "Contacted", "open", 25], ["qualified", "Qualified", "open", 50], ["proposal", "Proposal", "open", 75], ["won", "Won", "won", 100], ["lost", "Lost", "lost", 0]]);
    expect(await listPipelines(fixture.db, "viewer-a", tenantA)).toHaveLength(1);
    pipelineB = (await listPipelines(fixture.db, "owner-b", tenantB))[0];
  });
  it("lets only owners and admins change pipelines and stages", async () => {
    for (const user of ["member-a", "viewer-a"]) {
      await expect(createPipeline(fixture.db, user, tenantA, { name: "Denied" })).rejects.toMatchObject({ status: 403 });
      await expect(updateStage(fixture.db, user, tenantA, stage(pipelineA, "new").id, { name: "Denied", version: 1 })).rejects.toMatchObject({ status: 403 });
      await expect(createStage(fixture.db, user, tenantA, pipelineA.id, { name: "Denied" })).rejects.toMatchObject({ status: 403 });
    }
    expect((await createPipeline(fixture.db, "admin-a", tenantA, { name: "Partnerships" })).isDefault).toBe(false);
  });
  it("adds open stages before the closed ones, reorders, and edits probability with versions", async () => {
    const added = await createStage(fixture.db, "owner-a", tenantA, pipelineA.id, { name: "Visit planned", probability: 60, color: "primary" });
    expect(added).toMatchObject({ key: "visit_planned", kind: "open", probability: 60 });
    let [pipeline] = await listPipelines(fixture.db, "owner-a", tenantA);
    expect(pipeline.stages.map((item) => item.key)).toEqual(["new", "contacted", "qualified", "proposal", "visit_planned", "won", "lost"]);
    const order = pipeline.stages.map((item) => item.id);
    [order[3], order[4]] = [order[4], order[3]];
    expect((await reorderStages(fixture.db, "owner-a", tenantA, pipelineA.id, { stageIds: order })).stages.map((item) => item.key))
      .toEqual(["new", "contacted", "qualified", "visit_planned", "proposal", "won", "lost"]);
    await expect(reorderStages(fixture.db, "owner-a", tenantA, pipelineA.id, { stageIds: order.slice(1) })).rejects.toMatchObject({ status: 409 });
    [pipeline] = await listPipelines(fixture.db, "owner-a", tenantA);
    const proposal = stage(pipeline, "proposal");
    expect((await updateStage(fixture.db, "owner-a", tenantA, proposal.id, { probability: 80, version: proposal.version })).probability).toBe(80);
    await expect(updateStage(fixture.db, "owner-a", tenantA, proposal.id, { probability: 70, version: proposal.version })).rejects.toMatchObject({ status: 409 });
    pipelineA = (await listPipelines(fixture.db, "owner-a", tenantA))[0];
  });
  it("keeps stage key, kind and pipeline immutable in SQL", async () => {
    for (const change of [sql`key = 'renamed'`, sql`kind = 'won'`, sql`pipeline_id = ${pipelineB.id}::uuid`]) {
      await expect(withTenant(fixture.db, "owner-a", tenantA, "crm:pipelines_write", (tx) => tx.execute(sql`update crm_pipeline_stages set ${change} where id = ${stage(pipelineA, "new").id}::uuid`))).rejects.toThrow();
    }
  });
});

describe("deals", () => {
  let dealId: string, version: number;
  it("creates a deal in the default pipeline's first open stage and requires a relation", async () => {
    await expect(later(() => createDeal(fixture.db, "member-a", tenantA, { name: "No relation" }))).rejects.toMatchObject({ status: 400 });
    const created = await createDeal(fixture.db, "member-a", tenantA, { name: "Fabric order", companyId: companyA, contactId: personA, amount: "1000", expectedCloseDate: daysFromToday(30), ownerUserId: "member-a" });
    dealId = created.id; version = created.version;
    const { deal } = await getDeal(fixture.db, "viewer-a", tenantA, dealId);
    expect(deal).toMatchObject({ stageId: stage(pipelineA, "new").id, amount: "1000.00", currency: "USD", companyName: "Thyatira Cloth", contactName: "Synthetic Lydia", ownerName: "Synthetic member-a" });
  });
  it("rejects foreign relations, non-member owners and invalid input", async () => {
    await expect(createDeal(fixture.db, "member-a", tenantA, { name: "Foreign", companyId: companyB })).rejects.toMatchObject({ status: 404 });
    await expect(createDeal(fixture.db, "member-a", tenantA, { name: "Outsider", companyId: companyA, ownerUserId: "outsider" })).rejects.toMatchObject({ status: 400 });
    await expect(createDeal(fixture.db, "member-a", tenantA, { name: "Other pipeline stage", companyId: companyA, stageId: stage(pipelineB, "new").id })).rejects.toMatchObject({ status: 404 });
    await expect(later(() => createDeal(fixture.db, "member-a", tenantA, { name: "Bad amount", companyId: companyA, amount: "-5" }))).rejects.toMatchObject({ status: 400 });
    await expect(later(() => createDeal(fixture.db, "member-a", tenantA, { name: "Euro", companyId: companyA, currency: "EUR" as "USD" }))).rejects.toMatchObject({ status: 400 });
  });
  it("updates with versions, refuses a reason on an open deal, and audits field names only", async () => {
    const updated = await updateDeal(fixture.db, "member-a", tenantA, dealId, { amount: "2500.50", name: "Fabric order (large)", version });
    expect(updated.version).toBe(version + 1);
    await expect(updateDeal(fixture.db, "member-a", tenantA, dealId, { amount: "1", version })).rejects.toMatchObject({ status: 409 });
    version = updated.version;
    await expect(updateDeal(fixture.db, "member-a", tenantA, dealId, { closedReason: "Too early", version })).rejects.toMatchObject({ status: 400 });
    await expect(updateDeal(fixture.db, "member-a", tenantA, dealId, { companyId: null, contactId: null, version })).rejects.toMatchObject({ status: 400 });
    const [log] = await fixture.admin.query("select metadata from audit_logs where target_id=$1 and action='opportunity.update'", [dealId]).then((result) => result.rows);
    expect(log.metadata).toEqual({ fields: "name,amount" });
    expect(JSON.stringify(log)).not.toContain("2500");
  });
  it("moves once per drop: same-stage moves write nothing, stale and cross-pipeline moves are refused", async () => {
    const contacted = stage(pipelineA, "contacted");
    const moved = await moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: contacted.id, version });
    expect(moved).toMatchObject({ stageId: contacted.id, version: version + 1 });
    // A repeated drop with the old version is refused and changes nothing.
    await expect(moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: stage(pipelineA, "qualified").id, version })).rejects.toMatchObject({ status: 409, details: { reason: "stale" } });
    version = moved.version;
    expect(await moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: contacted.id, version })).toMatchObject({ version });
    await expect(moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: stage(pipelineB, "won").id, version })).rejects.toMatchObject({ status: 404 });
    const other = (await listPipelines(fixture.db, "owner-a", tenantA)).find((item) => item.name === "Partnerships")!;
    await expect(moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: stage(other, "won").id, version })).rejects.toMatchObject({ status: 400 });
    const moves = await fixture.admin.query("select metadata from audit_logs where target_id=$1 and action='opportunity.move'", [dealId]);
    expect(moves.rows).toEqual([{ metadata: { fromStageId: stage(pipelineA, "new").id, toStageId: contacted.id } }]);
  });
  it("records a reason when closing and clears it when reopened", async () => {
    const won = await moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: stage(pipelineA, "won").id, version, closedReason: "Signed at the fair" });
    expect((await getDeal(fixture.db, "member-a", tenantA, dealId)).deal.closedReason).toBe("Signed at the fair");
    const reopened = await moveDeal(fixture.db, "member-a", tenantA, dealId, { stageId: stage(pipelineA, "proposal").id, version: won.version, closedReason: "ignored" });
    const { deal, activity } = await getDeal(fixture.db, "member-a", tenantA, dealId);
    expect(deal).toMatchObject({ closedReason: null, stageId: stage(pipelineA, "proposal").id });
    expect(activity[0]).toMatchObject({ action: "opportunity.move", fromStage: "Won", toStage: "Proposal" });
    version = reopened.version;
  });
  it("denies viewers every deal mutation", async () => {
    await expect(createDeal(fixture.db, "viewer-a", tenantA, { name: "Denied", companyId: companyA })).rejects.toMatchObject({ status: 403 });
    await expect(updateDeal(fixture.db, "viewer-a", tenantA, dealId, { name: "Denied", version })).rejects.toMatchObject({ status: 403 });
    await expect(moveDeal(fixture.db, "viewer-a", tenantA, dealId, { stageId: stage(pipelineA, "won").id, version })).rejects.toMatchObject({ status: 403 });
  });
});

describe("board totals, stale deals and filters", () => {
  it("sums open stages, weights by probability, skips missing amounts and flags stale open deals only", async () => {
    const qualified = stage(pipelineA, "qualified"), won = stage(pipelineA, "won");
    const late = await createDeal(fixture.db, "owner-a", tenantA, { name: "Late visit", contactId: personA, amount: "400", stageId: qualified.id, expectedCloseDate: daysFromToday(-2) });
    await createDeal(fixture.db, "owner-a", tenantA, { name: "No amount", companyId: companyA, stageId: qualified.id, expectedCloseDate: daysFromToday(-1) });
    await createDeal(fixture.db, "owner-a", tenantA, { name: "Closed long ago", companyId: companyA, amount: "9000", stageId: won.id, expectedCloseDate: daysFromToday(-100) });
    const board = await listDeals(fixture.db, "viewer-a", tenantA, null, query());
    expect(board.total).toBe(4);
    // Open: 2500.50 (proposal, 80%) + 400 (qualified, 50%) + no amount. Won is excluded.
    expect(board.openTotal).toBe(2900.5);
    expect(board.weightedTotal).toBe(Math.round((2500.5 * 0.8 + 400 * 0.5) * 100) / 100);
    expect(board.stageTotals[won.id]).toEqual({ count: 1, amount: 9000 });
    const staleOnly = await listDeals(fixture.db, "viewer-a", tenantA, null, query({ stale: "1" }));
    expect(staleOnly.deals.map((deal) => deal.name).sort()).toEqual(["Late visit", "No amount"]);
    expect(staleOnly.empty).toBe(false);
    expect((await listDeals(fixture.db, "viewer-a", tenantA, null, query({ q: "thyatira" }))).total).toBe(3);
    expect((await listDeals(fixture.db, "viewer-a", tenantA, null, query({ owner: "member-a" }))).total).toBe(1);
    expect((await listDeals(fixture.db, "viewer-a", tenantA, null, query({ owner: "none" }))).total).toBe(3);
    expect((await listDeals(fixture.db, "viewer-a", tenantA, null, query({ min: "500", max: "5000" }))).deals.map((deal) => deal.name)).toEqual(["Fabric order (large)"]);
    const list = await listDeals(fixture.db, "viewer-a", tenantA, null, query({ mode: "list", sort: "-amount" }));
    expect(list.deals.map((deal) => deal.name)).toEqual(["Closed long ago", "Fabric order (large)", "Late visit", "No amount"]);
    expect(late.version).toBe(1);
    await expect(listDeals(fixture.db, "viewer-a", tenantA, null, query({ stage: stage(pipelineB, "new").id }))).rejects.toMatchObject({ status: 404 });
  });
  it("blocks archiving a stage or pipeline that still has deals, and the last open stage", async () => {
    const qualified = stage(pipelineA, "qualified");
    await expect(updateStage(fixture.db, "owner-a", tenantA, qualified.id, { archived: true, version: qualified.version })).rejects.toMatchObject({ status: 409, details: { reason: "stage_has_deals" } });
    await expect(updatePipeline(fixture.db, "owner-a", tenantA, pipelineA.id, { archived: true, version: pipelineA.version })).rejects.toMatchObject({ status: 409 });
    const other = (await listPipelines(fixture.db, "owner-a", tenantA)).find((item) => item.name === "Partnerships")!;
    for (const item of other.stages.filter((entry) => entry.kind === "open").slice(1)) await updateStage(fixture.db, "owner-a", tenantA, item.id, { archived: true, version: item.version });
    const lastOpen = other.stages.find((entry) => entry.kind === "open")!;
    await expect(updateStage(fixture.db, "owner-a", tenantA, lastOpen.id, { archived: true, version: lastOpen.version })).rejects.toMatchObject({ status: 409 });
    expect((await updatePipeline(fixture.db, "owner-a", tenantA, other.id, { archived: true, version: other.version })).archivedAt).not.toBeNull();
    await expect(createDeal(fixture.db, "owner-a", tenantA, { name: "Into archive", companyId: companyA, pipelineId: other.id })).rejects.toMatchObject({ status: 404 });
  });
  it("lists related deals on companies and people, for readers only in the right tenant", async () => {
    expect((await listRelatedDeals(fixture.db, "viewer-a", tenantA, "company", companyA)).deals.map((deal) => deal.name).sort()).toEqual(["Closed long ago", "Fabric order (large)", "No amount"]);
    expect((await listRelatedDeals(fixture.db, "viewer-a", tenantA, "person", personA)).deals).toHaveLength(2);
    expect((await listRelatedDeals(fixture.db, "owner-b", tenantB, "company", companyA)).deals).toEqual([]);
  });
});

describe("two-tenant isolation", () => {
  it("never exposes or accepts the other tenant's pipelines, stages or deals, in either direction", async () => {
    const dealB = await createDeal(fixture.db, "owner-b", tenantB, { name: "B deal", companyId: companyB });
    const [dealA] = (await listDeals(fixture.db, "owner-a", tenantA, null, query())).deals;
    // Service: A's users cannot reach B's workspace or ids, and the reverse.
    await expect(getDeal(fixture.db, "owner-a", tenantB, dealB.id)).rejects.toMatchObject({ status: 403 });
    await expect(getDeal(fixture.db, "owner-a", tenantA, dealB.id)).rejects.toMatchObject({ status: 404 });
    await expect(getDeal(fixture.db, "owner-b", tenantB, dealA.id)).rejects.toMatchObject({ status: 404 });
    await expect(moveDeal(fixture.db, "owner-b", tenantB, dealA.id, { stageId: stage(pipelineB, "won").id, version: dealA.version })).rejects.toMatchObject({ status: 404 });
    await expect(updateStage(fixture.db, "owner-b", tenantB, stage(pipelineA, "new").id, { name: "Hijack", version: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(listDeals(fixture.db, "owner-b", tenantB, pipelineA.id, query())).rejects.toMatchObject({ status: 404 });
    await expect(createDeal(fixture.db, "owner-b", tenantB, { name: "Cross", companyId: companyA })).rejects.toMatchObject({ status: 404 });
    // SQL: RLS hides the other tenant; composite FKs refuse a cross-tenant stage or company.
    await withTenant(fixture.db, "owner-b", tenantB, "opportunities:read", async (tx) => {
      expect((await tx.select().from(opportunities)).map((row) => row.id)).toEqual([dealB.id]);
      expect(await tx.update(opportunities).set({ name: "Hijack" }).where(eq(opportunities.id, dealA.id)).returning()).toEqual([]);
    });
    await expect(withTenant(fixture.db, "owner-b", tenantB, "opportunities:write", (tx, tenantId) => tx.insert(opportunities).values({ tenantId, name: "Cross stage", pipelineId: pipelineB.id, stageId: stage(pipelineA, "new").id, companyId: companyB, createdBy: "owner-b" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-b", tenantB, "opportunities:write", (tx) => tx.insert(opportunities).values({ tenantId: tenantA, name: "Wrong tenant", pipelineId: pipelineA.id, stageId: stage(pipelineA, "new").id, companyId: companyA, createdBy: "owner-b" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "opportunities:write", (tx, tenantId) => tx.insert(opportunities).values({ tenantId, name: "Foreign company", pipelineId: pipelineA.id, stageId: stage(pipelineA, "new").id, companyId: companyB, createdBy: "owner-a" }))).rejects.toThrow();
  });
  it("enforces the deal guards in SQL even without the service", async () => {
    const [deal] = (await listDeals(fixture.db, "owner-a", tenantA, null, query())).deals;
    const other = (await listPipelines(fixture.db, "owner-a", tenantA, { includeArchived: true })).find((item) => item.name === "Partnerships")!;
    const run = (statement: ReturnType<typeof sql>) => withTenant(fixture.db, "owner-a", tenantA, "opportunities:write", (tx) => tx.execute(statement));
    await expect(run(sql`update opportunities set pipeline_id = ${other.id}::uuid, stage_id = ${stage(other, "won").id}::uuid where id = ${deal.id}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/immutable|permission denied/) } });
    await expect(run(sql`update opportunities set closed_reason = 'x', stage_id = ${stage(pipelineA, "new").id}::uuid where id = ${deal.id}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringContaining("closed reason needs a closed stage") } });
    await expect(run(sql`update opportunities set owner_user_id = 'outsider' where id = ${deal.id}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringContaining("owner is not a member") } });
    await expect(run(sql`delete from opportunities where id = ${deal.id}::uuid`)).rejects.toThrow();
    // Positive control: a valid raw update passes the same guards.
    await expect(run(sql`update opportunities set owner_user_id = 'member-a' where id = ${deal.id}::uuid`)).resolves.toBeDefined();
  });
});

describe("erasure", () => {
  it("keeps the deal, unlinks the erased person and bumps the version", async () => {
    const person = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Erased" });
    const deal = await createDeal(fixture.db, "owner-a", tenantA, { name: "Person only", contactId: person.id });
    await eraseContact(fixture.db, "owner-a", tenantA, person.id);
    const { deal: after } = await getDeal(fixture.db, "owner-a", tenantA, deal.id);
    expect(after).toMatchObject({ contactId: null, contactName: null, version: 2 });
    expect(JSON.stringify((await fixture.admin.query("select * from opportunities where tenant_id=$1", [tenantA])).rows)).not.toContain(person.id);
    const logs = await fixture.admin.query("select metadata from audit_logs where target_id=$1", [deal.id]);
    expect(logs.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.rows)).not.toContain(person.id);
  });
});
