import { afterAll, beforeAll, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { addPeopleToList, audienceOverview, createAudienceList, createGroupFromFilter, deleteAudienceList, listAudiencePeople, removePersonFromList, renameAudienceList } from "../../src/server/newsletter-audience";
import { pageNewsletterConfiguration } from "../../src/server/newsletter";
import { fullState } from "../../src/lib/crm-fields";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "aud-owner", other = "aud-other", member = "aud-member", viewer = "aud-viewer";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, elsewhere: string;
beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, other, member, viewer].map((id) => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(fixture.db, owner, "Audience ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Other ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'member'),($1,$3,'viewer')", [tenant, member, viewer]);
}, 60_000);
afterAll(async () => { await fixture?.close(); });

const person = (name: string, email: string) => createContact(fixture.db, owner, tenant, { name, email, notes: "" });
const consent = (id: string, status: "granted" | "withdrawn", purpose: "newsletter" = "newsletter") =>
  recordConsent(fixture.db, owner, tenant, id, { purpose, status, channel: "email", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" });
const lens = (kind: "all" | "status", status?: string) => (kind === "all" ? { kind: "all" as const } : { kind: "status" as const, status: status as "subscribed" });
const names = async (l: Parameters<typeof listAudiencePeople>[4]) => (await listAudiencePeople(fixture.db, owner, tenant, {}, l)).rows.map((row) => row.name).sort();

it("derives each status from the consent ledger and list memberships, and never infers a grant", async () => {
  const ada = await person("Ada Never", "ada@example.test"), ben = await person("Ben Ready", "ben@example.test"), cy = await person("Cy Out", "cy@example.test"), di = await person("Di Listed", "di@example.test");
  await consent(ben.id, "granted"); await consent(cy.id, "withdrawn"); await consent(di.id, "granted");
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Weekly" });
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [di.id] })).outcomes[di.id]).toBe("added");
  // No recorded consent: refused and not changed. Withdrawn: refused.
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [ada.id, cy.id] })).outcomes).toEqual({ [ada.id]: "needs_consent", [cy.id]: "needs_consent" });
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [di.id] })).outcomes[di.id]).toBe("already");
  const overview = await audienceOverview(fixture.db, owner, tenant);
  expect(overview.counts).toMatchObject({ all: 4, subscribed: 1, not_on_list: 1, unsubscribed: 1, never: 1, suppressed: 0 });
  expect(overview.lists).toEqual([expect.objectContaining({ id: list.id, subscribed: 1 })]);
  expect(await names(lens("status", "subscribed"))).toEqual(["Di Listed"]);
  expect(await names(lens("status", "never"))).toEqual(["Ada Never"]);
  expect(await names({ kind: "list", id: list.id })).toEqual(["Di Listed"]);
  const page = await listAudiencePeople(fixture.db, owner, tenant, {}, { kind: "list", id: list.id });
  expect(page.rows[0].extra).toMatchObject({ listState: "subscribed", audienceStatus: "subscribed" });
  // A later withdrawal (do not contact) beats the list membership at once.
  await consent(di.id, "withdrawn");
  expect(await names(lens("status", "subscribed"))).toEqual([]);
  expect(await names(lens("status", "unsubscribed"))).toEqual(["Cy Out", "Di Listed"]);
});

it("shares the CRM search and filter predicates and honours saved groups", async () => {
  const filtered = await listAudiencePeople(fixture.db, owner, tenant, { q: "Ben" }, { kind: "all" });
  expect(filtered.rows.map((row) => row.name)).toEqual(["Ben Ready"]);
  const state = fullState({ filters: [{ field: "newsletter", op: "any_of", value: ["granted"] }] });
  const group = await createGroupFromFilter(fixture.db, owner, tenant, { name: "Consented", state });
  expect(await names({ kind: "group", id: group.id })).toEqual(["Ben Ready"]);
  const overview = await audienceOverview(fixture.db, owner, tenant);
  expect(overview.groups).toEqual([expect.objectContaining({ id: group.id, name: "Consented" })]);
  await expect(createGroupFromFilter(fixture.db, owner, tenant, { name: "Bad", state: { ...state, sources: [{ mode: "include", match: "any", kinds: ["manual"], campaigns: [], links: [], forms: [] }] } })).rejects.toBeTruthy();
  await expect(createGroupFromFilter(fixture.db, owner, tenant, { name: "Bad", state: fullState({ filters: [{ field: "nope", op: "is", value: "x" }] }) })).rejects.toBeTruthy();
});

it("creates, renames and deletes lists with versions, names, campaign use and role rules", async () => {
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Prayer" });
  await expect(createAudienceList(fixture.db, owner, tenant, { name: "prayer" })).rejects.toMatchObject({ status: 409 });
  const renamed = await renameAudienceList(fixture.db, owner, tenant, list.id, { name: "Prayer chain", version: list.version });
  expect(renamed.version).toBe(list.version + 1);
  await expect(renameAudienceList(fixture.db, owner, tenant, list.id, { name: "Stale", version: list.version })).rejects.toMatchObject({ status: 409 });
  // Members read; only owners and admins write. Viewers and other ministries see nothing.
  expect((await audienceOverview(fixture.db, member, tenant)).lists.length).toBeGreaterThan(0);
  await expect(createAudienceList(fixture.db, member, tenant, { name: "No" })).rejects.toMatchObject({ status: 404 });
  await expect(audienceOverview(fixture.db, viewer, tenant)).rejects.toMatchObject({ status: 404 });
  await expect(audienceOverview(fixture.db, other, tenant)).rejects.toBeTruthy();
  await expect(deleteAudienceList(fixture.db, other, tenant, list.id, { version: renamed.version })).rejects.toBeTruthy();
  expect((await audienceOverview(fixture.db, other, elsewhere)).lists).toEqual([]);
  await deleteAudienceList(fixture.db, owner, tenant, list.id, { version: renamed.version });
  expect((await audienceOverview(fixture.db, owner, tenant)).lists.map((l) => l.id)).not.toContain(list.id);
  expect((await pageNewsletterConfiguration(fixture.db, owner, tenant, "lists", {})).items.map((l) => l.id)).not.toContain(list.id);
  await expect(renameAudienceList(fixture.db, owner, tenant, list.id, { name: "Back", version: renamed.version + 1 })).rejects.toMatchObject({ status: 404 });
  // The name is free again once the list is gone.
  await expect(createAudienceList(fixture.db, owner, tenant, { name: "Prayer chain" })).resolves.toBeTruthy();
});

it("removes a person from one list only, keeps consent, and is stale-safe", async () => {
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Events" }), other_list = await createAudienceList(fixture.db, owner, tenant, { name: "Youth" });
  const eve = await person("Eve Both", "eve@example.test"); await consent(eve.id, "granted");
  await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [eve.id] }); await addPeopleToList(fixture.db, owner, tenant, other_list.id, { contactIds: [eve.id] });
  const row = (await listAudiencePeople(fixture.db, owner, tenant, {}, { kind: "list", id: list.id })).rows[0].extra!;
  await expect(removePersonFromList(fixture.db, owner, tenant, list.id, { subscriberId: String(row.subscriberId), version: Number(row.subscriptionVersion) + 1 })).rejects.toMatchObject({ status: 409 });
  expect(await removePersonFromList(fixture.db, owner, tenant, list.id, { subscriberId: String(row.subscriberId), version: Number(row.subscriptionVersion) })).toEqual({ state: "unsubscribed" });
  expect((await listAudiencePeople(fixture.db, owner, tenant, {}, { kind: "list", id: list.id })).rows[0].extra).toMatchObject({ listState: "unsubscribed" });
  expect((await listAudiencePeople(fixture.db, owner, tenant, {}, { kind: "list", id: other_list.id })).rows[0].extra).toMatchObject({ listState: "subscribed", audienceStatus: "subscribed" });
  // Re-adding is allowed while the consent still stands.
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [eve.id] })).outcomes[eve.id]).toBe("added");
});

it("treats suppressed and bounced people as suppressed and refuses to re-add them", async () => {
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Giving" }), fay = await person("Fay Bounce", "fay@example.test"); await consent(fay.id, "granted");
  await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [fay.id] });
  await fixture.admin.query("update newsletter_subscriptions set state='bounced' where tenant_id=$1 and list_id=$2", [tenant, list.id]);
  expect(await names(lens("status", "suppressed"))).toContain("Fay Bounce");
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [fay.id] })).outcomes[fay.id]).toBe("suppressed");
});

it("cleans up on erase and merge, and keeps the columns an ordinary restricted owner can read", async () => {
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Cleanup" });
  const gus = await person("Gus Erase", "gus@example.test"), hal = await person("Hal Target", "hal@example.test"), ivy = await person("Ivy Source", "ivy@example.test");
  for (const c of [gus, hal, ivy]) await consent(c.id, "granted");
  await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [gus.id, ivy.id] });
  await eraseContact(fixture.db, owner, tenant, gus.id);
  expect((await fixture.admin.query("select 1 from newsletter_subscribers where contact_id=$1", [gus.id])).rowCount).toBe(0);
  const version = async (id: string) => (await fixture.admin.query("select version from contacts where id=$1", [id])).rows[0].version as number;
  await mergeContacts(fixture.db, owner, tenant, hal.id, { sourceId: ivy.id, targetVersion: await version(hal.id), sourceVersion: await version(ivy.id) });
  expect((await fixture.admin.query("select 1 from newsletter_subscribers where contact_id=$1", [ivy.id])).rowCount).toBe(0);
  const members = await listAudiencePeople(fixture.db, owner, tenant, {}, { kind: "list", id: list.id });
  expect(members.rows.map((row) => row.name)).not.toContain("Gus Erase");
  const column = await fixture.admin.query("select data_type, is_nullable from information_schema.columns where table_name='newsletter_lists' and column_name='archived_at'");
  expect(column.rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
});
