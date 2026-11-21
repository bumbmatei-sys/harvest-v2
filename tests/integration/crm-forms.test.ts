import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { listPipelines } from "../../src/server/crm-deals";
import { createCrmForm, duplicateCrmForm, getCrmForm, listCrmForms, saveCrmForm } from "../../src/server/crm-forms";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, pipelineA: string;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "owner-b", "member-a", "admin-a", "viewer-a"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Forms A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Forms B")).tenantId;
  for (const [user, role] of [["member-a", "member"], ["admin-a", "admin"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
  pipelineA = (await listPipelines(fixture.db, "owner-a", tenantA))[0].id;
});
afterAll(async () => { await fixture?.close(); });

describe("CRM forms drafts (no migration: forms and form_versions)", () => {
  it("creates a form from a template, lists it and loads it back with a valid definition", async () => {
    const { id } = await createCrmForm(fixture.db, "owner-a", tenantA, { template: "visitor", destination: { type: "people" } });
    const list = await listCrmForms(fixture.db, "owner-a", tenantA);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, title: "Visitor card", destination: { type: "people" }, createdBy: "owner-a" });
    const loaded = await getCrmForm(fixture.db, "owner-a", tenantA, id);
    expect(loaded.definition.blocks.at(-1)?.type).toBe("consent");
    expect(loaded.definition.revision).toBe(1);
    // Admins build forms too.
    expect((await createCrmForm(fixture.db, "admin-a", tenantA, { template: null, destination: { type: "organizations" } })).id).toBeTruthy();
  });
  it("saves with a revision and rejects a stale or invalid save", async () => {
    const { id } = await createCrmForm(fixture.db, "owner-a", tenantA, { template: "prayer", destination: { type: "people" } });
    const { definition } = await getCrmForm(fixture.db, "owner-a", tenantA, id);
    const saved = await saveCrmForm(fixture.db, "owner-a", tenantA, id, { definition: { ...definition, title: "Prayer wall" }, revision: 1 });
    expect(saved.revision).toBe(2);
    expect((await getCrmForm(fixture.db, "owner-a", tenantA, id)).definition).toMatchObject({ title: "Prayer wall", revision: 2 });
    await expect(saveCrmForm(fixture.db, "admin-a", tenantA, id, { definition, revision: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(saveCrmForm(fixture.db, "owner-a", tenantA, id, { definition: { ...definition, blocks: [] }, revision: 2 })).rejects.toThrow();
    await expect(saveCrmForm(fixture.db, "owner-a", tenantA, id, { definition: { ...definition, logoUrl: "http://x.test/a.png" }, revision: 2 })).rejects.toThrow();
  });
  it("answers a schema-valid but oversize definition with a clear 400, not a database 500", async () => {
    const { id } = await createCrmForm(fixture.db, "owner-a", tenantA, { template: null, destination: { type: "people" } });
    const { definition } = await getCrmForm(fixture.db, "owner-a", tenantA, id);
    const consent = definition.blocks[definition.blocks.length - 1];
    const big = Array.from({ length: 39 }, (_, i) => ({ id: `big${String(i).padStart(5, "0")}`, type: "dropdown" as const, label: "x".repeat(200), required: false, mapTo: null,
      options: Array.from({ length: 20 }, (_, j) => `${j}`.padEnd(100, "o")) }));
    const oversize = { ...definition, blocks: [...big, consent] };
    expect(Buffer.byteLength(JSON.stringify(oversize))).toBeGreaterThan(65536);
    await expect(saveCrmForm(fixture.db, "owner-a", tenantA, id, { definition: oversize, revision: 1 })).rejects.toMatchObject({ status: 400, details: { reason: "too_large" } });
    // Nothing was written: the form is unchanged and still saves a normal edit at the same revision.
    expect((await getCrmForm(fixture.db, "owner-a", tenantA, id)).definition.revision).toBe(1);
    await expect(saveCrmForm(fixture.db, "owner-a", tenantA, id, { definition: { ...definition, title: "Fits" }, revision: 1 })).resolves.toMatchObject({ revision: 2 });
  });
  it("accepts a pipeline destination only from the same ministry", async () => {
    await expect(createCrmForm(fixture.db, "owner-a", tenantA, { template: null, destination: { type: "pipeline", pipelineId: pipelineA } })).resolves.toBeTruthy();
    await expect(createCrmForm(fixture.db, "owner-b", tenantB, { template: null, destination: { type: "pipeline", pipelineId: pipelineA } })).rejects.toMatchObject({ status: 400 });
    await expect(createCrmForm(fixture.db, "owner-a", tenantA, { template: null, destination: { type: "pipeline", pipelineId: randomUUID() } })).rejects.toMatchObject({ status: 400 });
  });
  it("duplicates a draft", async () => {
    const { id } = await createCrmForm(fixture.db, "owner-a", tenantA, { template: "event", destination: { type: "people" } });
    const copy = await duplicateCrmForm(fixture.db, "owner-a", tenantA, id);
    expect(copy.id).not.toBe(id);
    expect((await getCrmForm(fixture.db, "owner-a", tenantA, copy.id)).definition).toMatchObject({ title: "Copy of Event registration", revision: 1 });
  });
  it("is owner/admin only and never crosses ministries", async () => {
    for (const user of ["member-a", "viewer-a"]) {
      await expect(listCrmForms(fixture.db, user, tenantA)).rejects.toMatchObject({ status: 403 });
      await expect(createCrmForm(fixture.db, user, tenantA, { template: null, destination: null })).rejects.toMatchObject({ status: 403 });
    }
    const { id } = (await listCrmForms(fixture.db, "owner-a", tenantA))[0];
    await expect(getCrmForm(fixture.db, "owner-b", tenantB, id)).rejects.toMatchObject({ status: 404 });
    await expect(getCrmForm(fixture.db, "owner-b", tenantA, id)).rejects.toMatchObject({ status: 403 });
    expect(await listCrmForms(fixture.db, "owner-b", tenantB)).toEqual([]);
  });
  it("stays draft, so source filters and Connect (published versions only) never list them", async () => {
    const rows = await fixture.admin.query(`select status, definition->>'kind' as kind from form_versions where definition->>'kind' = 'crm-form-v1'`);
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) expect(row.status).toBe("draft");
  });
});
