import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { changeMemberAccess } from "../../src/server/access";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { applyIntakeRights, publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { connectBeginnerCourse, connectCourseSetting } from "../../src/server/connect-beginner-course";
import { createCatalogItem, getCatalogContent, setCatalogState } from "../../src/server/free-catalog";
import { withTenant } from "../../src/server/tenancy";

let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, another: string, code: string, course: string, foreign: string, receiptToken: string;
const owner = "course-owner", outside = "course-outside", learner = "course-learner", editor = "course-editor";
const slug = "test-beginner-course";
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Start here" }] }] };
async function makeCourse(actor: string, workspace: string, address: string) {
  const item = await createCatalogItem(f.db, actor, workspace, { kind: "course", slug: address, title: "Beginner course", visibility: "unlisted",
    lessons: [{ title: "Welcome", published: true, body }, { title: "Private draft", published: false, body }] });
  await setCatalogState(f.db, actor, workspace, item.id, { version: item.version, state: "published" });
  return item.id;
}
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic");
  vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "e".repeat(64));
  vi.stubEnv("DATABASE_URL", f.appURL);
  await f.db.insert(users).values([owner, outside, learner, editor].map(id => ({ id, name: id, email: `${id}@example.invalid` })));
  tenant = (await createWorkspace(f.db, owner, "Synthetic ministry")).tenantId;
  another = (await createWorkspace(f.db, outside, "Other ministry")).tenantId;
  await putMember(f.db, owner, tenant, `${editor}@example.invalid`, "member");
  await changeMemberAccess(f.db, owner, tenant, { userId: editor, role: "collaborator", grants: { catalog: "manage" } });
  course = await makeCourse(owner, tenant, slug);
  foreign = await makeCourse(outside, another, "foreign-beginner-course");
  const campaign = (await createCampaign(f.db, owner, tenant, { name: "Synthetic event", type: "conference" }, "course-event")).id;
  const version = await publishIntakeForm(f.db, owner, tenant, campaign, { name: "Test form", notice: "Synthetic consent wording",
    retentionDays: 3, purposes: ["outreach_follow_up"],
    definition: { kind: "connect-intake-v1", syntheticOnly: true, preferredName: true, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, owner, tenant, campaign, { label: "Test QR", formVersionId: version.id });
  await transitionConnectLink(f.db, owner, tenant, campaign, link.id, { action: "publish" });
  code = link.publicCode;
});
afterAll(async () => { vi.unstubAllEnvs(); await f?.close(); });

it("keeps beginner course settings within the ministry and Connect access", async () => {
  await expect(connectCourseSetting(f.db, owner, tenant)).resolves.toEqual({ beginnerCourseId: null });
  await expect(connectCourseSetting(f.db, owner, tenant, { beginnerCourseId: foreign })).rejects.toMatchObject({ status: 404 });
  await expect(connectCourseSetting(f.db, editor, tenant, { beginnerCourseId: course })).rejects.toMatchObject({ status: 403 });
  await expect(connectCourseSetting(f.db, owner, tenant, { beginnerCourseId: course })).resolves.toEqual({ beginnerCourseId: course });
});

it("starts guest lessons with a receipt, then enrols only on explicit request", async () => {
  const manifest = (await readIntakeManifest(f.db, "qr", code))!;
  receiptToken = manifest.receiptToken;
  const call = (input: object, actor?: string) => connectBeginnerCourse(f.db, "qr", code, { receiptToken, ...input }, actor);
  await expect(call({ action: "offer" })).rejects.toMatchObject({ status: 404 });
  await submitIntake(f.db, "qr", code, { submissionId: randomUUID(), receiptToken, stamp: manifest.stamp, capability: manifest.capability,
    purposes: ["outreach_follow_up"], preferredName: "Synthetic private response", email: "participant@example.invalid" });
  await expect(call({ action: "offer" })).resolves.toEqual({ slug, title: "Beginner course", summary: "" });
  const preview = await call({ action: "start", slug });
  expect(preview).toMatchObject({ lessons: [{ title: "Welcome", body }] });
  expect(JSON.stringify(preview)).not.toContain("Synthetic private response");
  expect((await f.admin.query("select 1 from catalog_enrolments where item_id=$1", [course])).rowCount).toBe(0);
  await expect(call({ action: "enrol", slug })).rejects.toMatchObject({ status: 401 });
  await expect(call({ action: "enrol", slug: "foreign-beginner-course" }, learner)).rejects.toMatchObject({ status: 404 });
  await expect(call({ action: "enrol", slug }, learner)).resolves.toEqual({ enrolled: true });
  await expect(getCatalogContent(f.db, learner, slug)).resolves.toMatchObject({ lessons: [{ title: "Welcome" }] });
  const { rows } = await f.admin.query("select source from entitlements where catalog_item_id=$1 and user_id=$2", [course, learner]);
  expect(rows).toEqual([{ source: "free_enrolment" }]);
  await withTenant(f.db, editor, tenant, "catalog:manage", async tx => {
    expect((await tx.execute("select id from campaign_responses")).rows).toEqual([]);
  });
  for (const query of ["select id from campaign_response_consents", "select sealed_data from connect_intake_receipts"]) {
    await expect(withTenant(f.db, editor, tenant, "catalog:manage", tx => tx.execute(query)))
      .rejects.toMatchObject({ cause: { code: "42501" } });
  }
  await applyIntakeRights(f.db, { receiptToken, action: "erase" });
  await expect(call({ action: "offer" })).rejects.toMatchObject({ status: 404 });
  await expect(getCatalogContent(f.db, learner, slug)).resolves.toMatchObject({ title: "Beginner course" });
});
