import { afterAll, beforeAll, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { defaultBrand } from "../../src/lib/email/blocks";
import { templateDocument } from "../../src/lib/email/templates";
import { getBrandKit, saveBrandKit } from "../../src/server/newsletter-campaigns/brand-kit";
import { getCampaign, reviewCampaign, testCampaignToSink, writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "nls-owner", otherOwner = "nls-other", member = "nls-member";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string;

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, otherOwner, member].map(id => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(fixture.db, owner, "Screens ministry", "church")).tenantId;
  other = (await createWorkspace(fixture.db, otherOwner, "Other ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'member')", [tenant, member]);
}, 60_000);
afterAll(async () => { await fixture?.close(); });

const kit = { ...defaultBrand, primary: "#112233", address: "1 Main Street" };

it("keeps the brand kit per ministry, versioned, and owner or admin only", async () => {
  expect(await getBrandKit(fixture.db, owner, tenant)).toMatchObject({ saved: false, version: 0, kit: defaultBrand });
  const first = await saveBrandKit(fixture.db, owner, tenant, { kit });
  expect(first).toMatchObject({ saved: true, version: 1, kit: { primary: "#112233" } });
  await expect(saveBrandKit(fixture.db, owner, tenant, { kit })).rejects.toMatchObject({ status: 409 });
  const second = await saveBrandKit(fixture.db, owner, tenant, { kit: { ...kit, accent: "#abcdef" }, version: 1 });
  expect(second.version).toBe(2);
  await expect(saveBrandKit(fixture.db, owner, tenant, { kit: { ...kit, logoUrl: "http://insecure.test/logo.png" }, version: 2 })).rejects.toThrow();
  await expect(saveBrandKit(fixture.db, owner, tenant, { kit: { ...kit, primary: "red" }, version: 2 })).rejects.toThrow();
  // Members cannot read or write it; another ministry never sees it.
  await expect(getBrandKit(fixture.db, member, tenant)).rejects.toMatchObject({ status: 404 });
  await expect(saveBrandKit(fixture.db, member, tenant, { kit, version: 2 })).rejects.toMatchObject({ status: 404 });
  await expect(getBrandKit(fixture.db, otherOwner, tenant)).rejects.toMatchObject({ status: 404 });
  expect(await getBrandKit(fixture.db, otherOwner, other)).toMatchObject({ saved: false, kit: defaultBrand });
  const rows = await fixture.admin.query("select tenant_id from newsletter_brand_kits");
  expect(rows.rows).toEqual([{ tenant_id: tenant }]);
});

it("saves an email-document draft without a list, renders it, and refuses review until a list is chosen", async () => {
  const content = templateDocument("weekly-update", kit);
  const draft = await writeCampaign(fixture.db, owner, tenant, { name: "Weekly", subject: "Hello", preheader: "Hi", selection: { listIds: [], segmentIds: [] }, content });
  expect(draft.selection).toEqual({ listIds: [], segmentIds: [] });
  expect(draft.preview.html).toContain("1 Main Street");
  expect(draft.preview.html).toContain("Unsubscribe");
  expect(draft.plainText).toContain("Unsubscribe");
  const read = await getCampaign(fixture.db, owner, tenant, draft.id);
  expect(read.content).toMatchObject({ version: 2, blocks: expect.any(Array) });
  const edited = await writeCampaign(fixture.db, owner, tenant, { name: "Weekly", subject: "Hello again", preheader: null, version: draft.version, selection: { listIds: [], segmentIds: [] }, content }, draft.id);
  expect(edited.revision).toBe(2);
  await expect(reviewCampaign(fixture.db, owner, tenant, draft.id, { version: edited.version, dispatch: { mode: "now" } })).rejects.toBeTruthy();
  await expect(writeCampaign(fixture.db, owner, tenant, { name: "Bad", subject: "x", selection: { listIds: [], segmentIds: [] },
    content: { ...content, blocks: [{ id: "bad-1", type: "hero", imageUrl: "http://x.test/a.png", alt: "", heading: "", text: "", buttonLabel: "", buttonUrl: "" }] } })).rejects.toBeTruthy();
});

it("sends the test only to the synthetic sink and only to the verified address of the signed-in admin", async () => {
  const draft = await writeCampaign(fixture.db, owner, tenant, { name: "Sink", subject: "Sink", selection: { listIds: [] }, content: templateDocument("welcome", kit) });
  expect(await testCampaignToSink(fixture.db, owner, tenant, draft.id, "nls-owner@example.test")).toEqual({ test: true, mailbox: "synthetic", state: "accepted" });
  await expect(testCampaignToSink(fixture.db, owner, tenant, draft.id, undefined)).rejects.toMatchObject({ status: 404 });
  await expect(testCampaignToSink(fixture.db, otherOwner, tenant, draft.id, "x@example.test")).rejects.toMatchObject({ status: 404 });
});
