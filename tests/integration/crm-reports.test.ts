import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact } from "../../src/server/contacts";
import { createCompany } from "../../src/server/companies";
import { createDeal, listPipelines, moveDeal, updateDeal } from "../../src/server/crm-deals";
import { createTask, updateTask } from "../../src/server/crm-tasks";
import { commitImport, createImport, previewImport } from "../../src/server/crm-imports";
import { mergeContacts } from "../../src/server/crm-merge";
import { getCrmReport, type CrmReport } from "../../src/server/crm-reports";
import { reportPeriods, type ReportPeriod } from "../../src/lib/crm-reports";
import { AccessError } from "../../src/server/permissions";

vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("@/db/client", () => ({ getDb: () => fixture.db }));
vi.mock("@/server/http", async (original) => ({
  ...await original<typeof import("../../src/server/http")>(),
  verifiedUser: async (request: Request) => { const user = request.headers.get("x-test-user"); if (!user) throw new AccessError(401, "Sign in to continue."); return user; },
}));

// Anchor: regions are R1 Aug 25-Oct 1, R2 Oct 1-24, R3 Oct 24-Nov 1, R4 Nov 1-16, R5 Nov 16-22 (see tests/unit/crm-reports.test.ts).
const now = new Date("2026-11-22T12:00:00Z");
const at = { R1: "2026-09-10T10:00:00Z", R2: "2026-10-10T10:00:00Z", R3: "2026-10-28T10:00:00Z", R4: "2026-11-05T10:00:00Z", R5: "2026-11-18T10:00:00Z" } as const;
let tenant: string, other: string, stages: { won: string; open: string; lost: string }, company: string;
const people = ["owner", "admin", "member-a", "member-a2", "viewer", "outsider", "owner-b"];
const report = (user: string, period: ReportPeriod, tenantId = tenant) => getCrmReport(fixture.db, user, tenantId, period, now);
const reports = async (user: string) => Object.fromEntries(await Promise.all(reportPeriods.map(async (period) => [period, await report(user, period)]))) as Record<ReportPeriod, CrmReport>;

/** Raw writes to backdate rows, bypassing guard triggers (replica role) on one connection. */
async function backdate(statement: string, params: unknown[]) {
  const client = await fixture.admin.connect();
  try { await client.query("set session_replication_role = replica"); await client.query(statement, params); } finally { await client.query("reset session_replication_role"); client.release(); }
}
const dealIn = async (region: keyof typeof at, kind: "won" | "open" | "lost", extra: { owner?: string; contactId?: string; archive?: boolean } = {}) => {
  const created = await createDeal(fixture.db, "owner", tenant, { name: `Synthetic ${kind}`, ...(extra.contactId ? { contactId: extra.contactId } : { companyId: company }), ownerUserId: extra.owner ?? "owner" });
  let version = created.version;
  if (kind !== "open") version = (await moveDeal(fixture.db, "owner", tenant, created.id, { stageId: stages[kind], version })).version;
  if (extra.archive) await updateDeal(fixture.db, "owner", tenant, created.id, { archived: true, version });
  await backdate("update opportunities set created_at = $1 where id = $2", [at[region], created.id]);
  return { id: created.id, version };
};
const personIn = async (region: keyof typeof at, name: string) => {
  const person = await createContact(fixture.db, "owner", tenant, { name });
  await backdate("update contacts set created_at = $1 where id = $2", [at[region], person.id]);
  return person;
};
const taskDone = async (assignee: string, region: keyof typeof at, times = 1, options: { archive?: boolean } = {}) => {
  const task = await createTask(fixture.db, "owner", tenant, { title: "Synthetic follow-up", assigneeUserId: assignee });
  let version = task.version;
  for (let time = 0; time < times; time++) {
    version = (await updateTask(fixture.db, "owner", tenant, task.id, { status: "done", version })).version;
    if (time < times - 1) version = (await updateTask(fixture.db, "owner", tenant, task.id, { status: "open", version })).version;
  }
  if (options.archive) await updateTask(fixture.db, "owner", tenant, task.id, { archived: true, version });
  await backdate("update audit_logs set created_at = $1 where target_id = $2 and action = 'task.complete'", [at[region], task.id]);
};
const taskOpen = async (assignee: string, due: "past" | "future") => {
  const task = await createTask(fixture.db, "owner", tenant, { title: "Synthetic open", assigneeUserId: assignee });
  await backdate("update crm_tasks set due_at = $1 where id = $2", [due === "past" ? "2026-11-20T10:00:00Z" : "2026-12-20T10:00:00Z", task.id]);
};

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(people.map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, "owner", "Reports A")).tenantId;
  other = (await createWorkspace(fixture.db, "owner-b", "Reports B")).tenantId;
  for (const [id, role] of [["admin", "admin"], ["member-a", "member"], ["member-a2", "member"], ["viewer", "viewer"]] as const) await putMember(fixture.db, "owner", tenant, `${id}@example.test`, role);
  const [pipeline] = await listPipelines(fixture.db, "owner", tenant);
  stages = { won: pipeline!.stages.find((s) => s.kind === "won")!.id, open: pipeline!.stages.find((s) => s.kind === "open")!.id, lost: pipeline!.stages.find((s) => s.kind === "lost")!.id };
  company = (await createCompany(fixture.db, "owner", tenant, { name: "Synthetic Corinth Tents" })).id;

  // Deals by region. R5: 5 open + 5 won tied to people (below); R4: 5 won + 5 lost; R3: 3 open (small); R2: 6 won; R1: 5 won.
  for (let n = 0; n < 5; n++) { const person = await personIn("R5", `Synthetic open deal person ${n}`); const deal = await dealIn("R5", "open", { contactId: person.id });
    if (n === 0) { const won = await moveDeal(fixture.db, "owner", tenant, deal.id, { stageId: stages.won, version: deal.version }); await moveDeal(fixture.db, "owner", tenant, deal.id, { stageId: stages.open, version: won.version }); } }
  for (let n = 0; n < 5; n++) { const person = await personIn("R5", `Synthetic won deal person ${n}`); await dealIn("R5", "won", { contactId: person.id, owner: "member-a" }); }
  await dealIn("R5", "won", { archive: true }); await dealIn("R5", "won", { archive: true, owner: "member-a" });
  for (let n = 0; n < 5; n++) { await dealIn("R4", "won"); await dealIn("R4", "lost"); }
  for (let n = 0; n < 3; n++) await dealIn("R3", "open");
  for (let n = 0; n < 6; n++) await dealIn("R2", "won");
  for (let n = 0; n < 5; n++) await dealIn("R1", "won");
  // A deal in another ministry never counts here.
  const foreign = await createCompany(fixture.db, "owner-b", other, { name: "Synthetic Foreign" });
  for (let n = 0; n < 6; n++) { const deal = await createDeal(fixture.db, "owner-b", other, { name: "Foreign", companyId: foreign.id }); await backdate("update opportunities set created_at = $1 where id = $2", [at.R5, deal.id]); }

  // Tasks. Member A: 5 completed once + 1 completed twice (reopened) in R5, 3 in R4, one completed then archived; owner's 2 in R5.
  for (let n = 0; n < 5; n++) await taskDone("member-a", "R5");
  await taskDone("member-a", "R5", 2); await taskDone("member-a", "R5", 1, { archive: true });
  for (let n = 0; n < 3; n++) await taskDone("member-a", "R4");
  for (let n = 0; n < 2; n++) await taskDone("owner", "R5");
  for (let n = 0; n < 5; n++) await taskOpen("member-a", "past");
  for (let n = 0; n < 2; n++) await taskOpen("member-a", "future");
  for (let n = 0; n < 3; n++) await taskOpen("owner", "past");
  for (let n = 0; n < 4; n++) await taskOpen("owner", "future");

  // Contacts (R5). Manual: 5 + 5 with deals above, 5 + one with an archived deal + a merge survivor without; 1 erased; a merged source; csv: 5; unknown source: 3.
  for (let n = 0; n < 5; n++) await personIn("R5", `Synthetic plain ${n}`);
  const archivedDeal = await personIn("R5", "Synthetic archived deal");
  const archived = await createDeal(fixture.db, "owner", tenant, { name: "Archived", contactId: archivedDeal.id }); await updateDeal(fixture.db, "owner", tenant, archived.id, { archived: true, version: archived.version });
  await backdate("update opportunities set created_at = $1 where id = $2", [at.R5, archived.id]);
  const keep = await personIn("R5", "Synthetic merge keep"), drop = await personIn("R5", "Synthetic merge drop");
  await mergeContacts(fixture.db, "owner", tenant, keep.id, { sourceId: drop.id, targetVersion: keep.version, sourceVersion: drop.version });
  const gone = await personIn("R5", "Synthetic erased"); await eraseContact(fixture.db, "owner", tenant, gone.id);
  const csv = await createImport(fixture.db, "owner", tenant, { entity: "person", clientKey: randomUUID(), fileName: "synthetic.csv", csv: `Name,Email\n${[1, 2, 3, 4, 5].map((n) => `Synthetic csv ${n},csv${n}@example.test`).join("\n")}` });
  await previewImport(fixture.db, "owner", tenant, csv.id, { version: csv.version }); await commitImport(fixture.db, "owner", tenant, csv.id);
  await backdate("update contacts set created_at = $1 where name like 'Synthetic csv %' and tenant_id = $2", [at.R5, tenant]);
  for (let n = 0; n < 3; n++) await backdate("insert into contacts(tenant_id, name, created_at) values ($1, $2, $3)", [tenant, `Synthetic legacy ${n}`, at.R5]);
}, 300_000);
afterAll(async () => { await fixture?.close(); });

describe("pipeline conversion", () => {
  it("counts deals created in the period by where they are now, archived excluded and a reopened deal by its creation", async () => {
    const all = await reports("owner");
    expect(all.last7.deals).toEqual({ created: 10, won: 5, open: 5, lost: 0, conversionPercent: 50 });
    expect(all.thisMonth.deals).toEqual({ created: 20, won: 10, open: 5, lost: 5, conversionPercent: 50 });
  });
  it("withholds the open row and the total when one region holds three deals, in every period that contains it", async () => {
    const all = await reports("owner");
    for (const period of ["last30", "last90", "lastMonth"] as const) expect(all[period].deals).toMatchObject({ created: null, open: null, conversionPercent: null });
    expect(all.last30.deals).toMatchObject({ won: 10, lost: 5 });
    expect(all.last90.deals).toMatchObject({ won: 21, lost: 5 });
    expect(all.lastMonth.deals).toMatchObject({ won: 6, lost: 0 });
  });
  it("lets no pair of published periods reveal a group of one to four by subtraction", async () => {
    const all = await reports("owner");
    const nested: [ReportPeriod, ReportPeriod][] = [["last7", "last30"], ["last30", "last90"], ["last7", "last90"], ["last7", "thisMonth"], ["thisMonth", "last90"], ["lastMonth", "last90"]];
    for (const [inner, outer] of nested) for (const key of ["created", "won", "open", "lost"] as const) {
      const a = all[inner].deals[key], b = all[outer].deals[key];
      if (a !== null && b !== null) expect(b - a === 0 || b - a >= 5, `${outer}-${inner} ${key}`).toBe(true);
    }
  });
  it("reports each member only their own deals and shows zero conversion as unavailable", async () => {
    const own = await reports("member-a");
    expect(own.last7.scope).toBe("own");
    expect(own.last90.deals).toEqual({ created: 5, won: 5, open: 0, lost: 0, conversionPercent: 100 });
    const none = await report("member-a2", "last7");
    expect(none.deals).toEqual({ created: 0, won: 0, open: 0, lost: 0, conversionPercent: null });
  });
});

describe("follow-up tasks", () => {
  it("counts completion events (a reopened task counts again, archived tasks do not) and keeps Connect cases out", async () => {
    expect((await report("owner", "last7")).tasks.completed).toBe(9);
    expect((await report("member-a", "last7")).tasks.completed).toBe(7);
    expect((await report("member-a2", "last7")).tasks.completed).toBe(0);
  });
  it("withholds a total whose region holds fewer than five completions", async () => {
    expect((await report("owner", "thisMonth")).tasks.completed).toBeNull();
    expect((await report("member-a", "thisMonth")).tasks.completed).toBeNull();
  });
  it("shows a live overdue snapshot and hides the pair when a complementary cell is needed", async () => {
    expect((await report("owner", "last30")).tasks).toMatchObject({ overdue: 8, onTime: 6, open: 14 });
    expect((await report("member-a", "last30")).tasks).toMatchObject({ overdue: null, onTime: null, open: 7 });
    expect((await report("member-a2", "last30")).tasks).toMatchObject({ overdue: 0, onTime: 0, open: 0 });
  });
});

describe("source performance and contact growth", () => {
  it("credits the first source, counts a merged pair once, drops erased people and treats an unarchived open or won deal as 'with a deal'", async () => {
    const { contacts } = await report("owner", "last7");
    expect(contacts?.added).toBe(25);
    expect(contacts?.withDeal).toBe(10);
    expect(contacts?.sources.find((s) => s.source === "manual")).toEqual({ source: "manual", added: 17, withDeal: 10 });
    expect(contacts?.sources.filter((s) => ["connect", "form"].includes(s.source))).toEqual([{ source: "connect", added: 0, withDeal: 0 }, { source: "form", added: 0, withDeal: 0 }]);
  });
  it("hides the small unknown-source group and one more row so the total cannot be subtracted", async () => {
    const { contacts } = await report("owner", "last7");
    expect(contacts?.sources.find((s) => s.source === "unknown")).toEqual({ source: "unknown", added: null, withDeal: null });
    expect(contacts?.sources.find((s) => s.source === "csv_import")).toEqual({ source: "csv_import", added: null, withDeal: null });
  });
  it("matches across a period that holds only this month's regions", async () => {
    expect((await report("admin", "thisMonth")).contacts?.added).toBe(25);
  });
  it("is not part of a member's report", async () => {
    expect((await report("member-a", "last7")).contacts).toBeUndefined();
  });
});

describe("source evidence expiry", () => {
  it("credits a contact whose form evidence has expired to Unknown, because the report reads source events under RLS", async () => {
    const ministry = (await createWorkspace(fixture.db, "owner-b", "Reports expiry")).tenantId;
    for (let n = 0; n < 10; n++) {
      const person = await createContact(fixture.db, "owner-b", ministry, { name: `Synthetic form person ${n}` });
      const response = randomUUID(), expires = n < 5 ? "2027-12-01T00:00:00Z" : "2026-11-10T00:00:00Z";
      await backdate("update contacts set created_at = $1 where id = $2", [at.R5, person.id]);
      await backdate("delete from contact_source_events where contact_id = $1", [person.id]);
      await backdate(`insert into crm_form_responses(tenant_id, id, form_id, version_id, contact_id, labels, answers, consent_block_id, request_hash, created_contact, submitted_at, expires_at)
        values ($1, $2, gen_random_uuid(), gen_random_uuid(), $3, '{}', '{"consent":"yes"}'::jsonb, 'consent', $4, true, $5, $6)`, [ministry, response, person.id, "a".repeat(64), at.R4, expires]);
      await backdate("insert into contact_source_events(tenant_id, contact_id, kind, outcome, occurred_at, crm_form_response_id) values ($1, $2, 'form', 'created', $3, $4)", [ministry, person.id, at.R5, response]);
    }
    const { contacts } = await getCrmReport(fixture.db, "owner-b", ministry, "last7", now);
    expect(contacts?.added).toBe(10);
    expect(contacts?.sources.find((s) => s.source === "form")).toEqual({ source: "form", added: 5, withDeal: 0 });
    expect(contacts?.sources.find((s) => s.source === "unknown")).toEqual({ source: "unknown", added: 5, withDeal: 0 });
  });
});

describe("access and isolation", () => {
  it("denies viewers, strangers and unknown periods with neutral errors", async () => {
    await expect(report("viewer", "last7")).rejects.toMatchObject({ status: 403 });
    await expect(report("outsider", "last7")).rejects.toMatchObject({ status: 403 });
    await expect(report("owner", "last7", other)).rejects.toMatchObject({ status: 403 });
    await expect(report("owner", "last365" as ReportPeriod)).rejects.toMatchObject({ status: 400 });
  });
  it("gives another ministry only its own numbers", async () => {
    const foreign = await getCrmReport(fixture.db, "owner-b", other, "last7", now);
    expect(foreign.deals).toEqual({ created: 6, won: 0, open: 6, lost: 0, conversionPercent: 0 });
    expect(foreign.tasks.completed).toBe(0);
    expect((await report("owner", "last7")).deals.created).toBe(10);
  });
  it("serves the route with no-store caching, 401 without a session and 403 for viewers", async () => {
    const { GET } = await import("../../src/app/api/workspaces/[tenantId]/crm/reports/route");
    const call = (user: string | null, search = "?period=last7") => GET(new Request(`http://localhost/api/workspaces/${tenant}/crm/reports${search}`, { headers: user ? { "x-test-user": user } : {} }), { params: Promise.resolve({ tenantId: tenant }) });
    const ok = await call("owner");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await ok.json()).period).toBe("last7");
    expect((await call(null)).status).toBe(401);
    expect((await call("viewer")).status).toBe(403);
    expect((await call("owner", "?period=bad")).status).toBe(400);
    expect(JSON.stringify(await (await call("owner")).json())).not.toMatch(/Synthetic|@example/);
  });
});
