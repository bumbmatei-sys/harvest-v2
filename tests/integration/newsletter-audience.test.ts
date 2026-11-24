import { afterAll, beforeAll, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { createContact, eraseContact, recordConsent } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { addPeopleToList, audienceOverview, createAudienceList, createGroupFromFilter, deleteAudienceGroup, deleteAudienceList, renameAudienceGroup, listAudiencePeople, removePersonFromList, renameAudienceList } from "../../src/server/newsletter-audience";
import { pageNewsletterConfiguration } from "../../src/server/newsletter";
import { fullState } from "../../src/lib/crm-fields";
import { writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { templateDocument } from "../../src/lib/email/templates";
import { defaultBrand } from "../../src/lib/email/blocks";
import { selectionPins } from "../../src/server/newsletter-campaigns/recipients";
import { withTenant } from "../../src/server/tenancy";
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

it("never reverses a person's own list unsubscribe, but allows re-adding after an admin removal", async () => {
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Optout" }), jo = await person("Jo Optout", "jo@example.test"), kim = await person("Kim Removed", "kim@example.test");
  for (const c of [jo, kim]) { await consent(c.id, "granted"); await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [c.id] }); }
  const row = async (id: string) => (await fixture.admin.query("select s.id as subscriber, ns.state, ns.version, ns.consent_id from newsletter_subscriptions ns join newsletter_subscribers s on s.id=ns.subscriber_id where s.contact_id=$1 and ns.list_id=$2", [id, list.id])).rows[0];
  // The person's own link (what nl02_apply_unsubscribe does for scope 'list'): unsubscribed, no consent change, audit by the system.
  const before = await row(jo.id);
  await fixture.admin.query("update newsletter_subscriptions set state='unsubscribed',consent_id=null,version=version+1,updated_at=clock_timestamp() where subscriber_id=$1 and list_id=$2", [before.subscriber, list.id]);
  await fixture.admin.query("insert into audit_logs(tenant_id,actor_id,action,target_id,metadata) values($1,null,'newsletter.unsubscribe.list',$2,jsonb_build_object('listId',$3::text))", [tenant, before.subscriber, list.id]);
  const opted = await row(jo.id);
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [jo.id] })).outcomes[jo.id]).toBe("opted_out");
  expect(await row(jo.id)).toEqual(opted);
  // An admin's own removal can be undone while consent stands.
  const kimRow = await row(kim.id);
  await removePersonFromList(fixture.db, owner, tenant, list.id, { subscriberId: kimRow.subscriber, version: kimRow.version });
  expect((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: [kim.id] })).outcomes[kim.id]).toBe("added");
});

it("renames and deletes saved groups: versions, pins, names, roles, hidden everywhere, and refused while an email in use pins it", async () => {
  const state = fullState({ filters: [{ field: "newsletter", op: "any_of", value: ["granted"] }] });
  const group = await createGroupFromFilter(fixture.db, owner, tenant, { name: "Granted people", state });
  await expect(createGroupFromFilter(fixture.db, owner, tenant, { name: "granted PEOPLE", state })).rejects.toMatchObject({ status: 409 });
  const before = (await audienceOverview(fixture.db, owner, tenant)).groups.find((g) => g.id === group.id)!;
  // A draft email pins the group; renaming moves the pin version so a review of the old pin cannot go out.
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Pin list" });
  const draft = await writeCampaign(fixture.db, owner, tenant, { name: "Pinned", subject: "Hi", selection: { listIds: [list.id], segmentIds: [group.id] }, content: templateDocument("welcome", { ...defaultBrand, address: "1 Main Street" }) });
  const renamed = await renameAudienceGroup(fixture.db, owner, tenant, group.id, { name: "Consented people", version: before.version });
  expect(renamed).toMatchObject({ name: "Consented people", version: before.version + 1 });
  expect((await fixture.admin.query("select name, version from crm_saved_views where id=(select saved_view_id from newsletter_segments where id=$1)", [group.id])).rows).toEqual([{ name: "Consented people", version: before.version + 1 }]);
  const pinned = await withTenant(fixture.db, owner, tenant, "newsletter:read", (tx, id) => selectionPins(tx, id, { listIds: [list.id], segmentIds: [group.id] }));
  expect(pinned.segments[0].version).toBe(before.version + 1);
  expect(draft.selection.segmentIds).toEqual([group.id]);
  await expect(renameAudienceGroup(fixture.db, owner, tenant, group.id, { name: "Stale", version: before.version })).rejects.toMatchObject({ status: 409 });
  const other_group = await createGroupFromFilter(fixture.db, owner, tenant, { name: "Another", state });
  await expect(renameAudienceGroup(fixture.db, owner, tenant, other_group.id, { name: "consented PEOPLE", version: 1 })).rejects.toMatchObject({ status: 409 });
  // Roles and tenants.
  await expect(renameAudienceGroup(fixture.db, member, tenant, group.id, { name: "No", version: renamed.version })).rejects.toMatchObject({ status: 404 });
  await expect(deleteAudienceGroup(fixture.db, viewer, tenant, group.id, { version: renamed.version })).rejects.toMatchObject({ status: 404 });
  await expect(deleteAudienceGroup(fixture.db, other, elsewhere, group.id, { version: renamed.version })).rejects.toMatchObject({ status: 404 });
  expect((await audienceOverview(fixture.db, member, tenant)).groups.map((g) => g.name)).toContain("Consented people");
  // In use by a ready email: refused. (The state is forced the way the review would leave it.)
  const client = await fixture.admin.connect();
  try {
    await client.query("set session_replication_role = replica");
    await client.query("update newsletter_campaigns set state='reviewed' where id=$1", [draft.id]);
    await expect(deleteAudienceGroup(fixture.db, owner, tenant, group.id, { version: renamed.version })).rejects.toMatchObject({ status: 409 });
    await client.query("update newsletter_campaigns set state='draft' where id=$1", [draft.id]);
  } finally { await client.query("reset session_replication_role"); client.release(); }
  await deleteAudienceGroup(fixture.db, owner, tenant, group.id, { version: renamed.version });
  expect((await audienceOverview(fixture.db, owner, tenant)).groups.map((g) => g.id)).not.toContain(group.id);
  await expect(withTenant(fixture.db, owner, tenant, "newsletter:read", (tx, id) => selectionPins(tx, id, { listIds: [list.id], segmentIds: [group.id] }))).rejects.toMatchObject({ status: 404 });
  expect((await pageNewsletterConfiguration(fixture.db, owner, tenant, "segments", {})).items.map((g) => g.id)).not.toContain(group.id);
  await expect(renameAudienceGroup(fixture.db, owner, tenant, group.id, { name: "Gone", version: renamed.version })).rejects.toMatchObject({ status: 404 });
  // The shared CRM view and the name stay free.
  expect((await fixture.admin.query("select 1 from crm_saved_views where name='Consented people'")).rowCount).toBe(1);
  await expect(createGroupFromFilter(fixture.db, owner, tenant, { name: "Consented people", state })).resolves.toBeTruthy();
});

it("limits group names to the shared view's 60 characters with a validation error, and answers 409 for a group whose shared view changed", async () => {
  const state = fullState({ filters: [{ field: "newsletter", op: "any_of", value: ["granted"] }] });
  const long = "x".repeat(61);
  await expect((async () => createGroupFromFilter(fixture.db, owner, tenant, { name: long, state }))()).rejects.toMatchObject({ name: "ZodError" });
  const ok = await createGroupFromFilter(fixture.db, owner, tenant, { name: "y".repeat(60) + "  ", state });
  expect(ok.name).toBe("y".repeat(60));
  const version = (await audienceOverview(fixture.db, owner, tenant)).groups.find((g) => g.id === ok.id)!.version;
  await expect((async () => renameAudienceGroup(fixture.db, owner, tenant, ok.id, { name: long, version }))()).rejects.toMatchObject({ name: "ZodError" });
  expect(await renameAudienceGroup(fixture.db, owner, tenant, ok.id, { name: "z".repeat(60) + " ", version })).toMatchObject({ name: "z".repeat(60) });
  // The shared view is edited (as CRM People can): the group is stuck. Rename and archive both answer a clear 409 (GROUP_STALE), never a 500; it stays inert.
  const stale = await createGroupFromFilter(fixture.db, owner, tenant, { name: "Stale group", state });
  const staleVersion = (await audienceOverview(fixture.db, owner, tenant)).groups.find((g) => g.id === stale.id)!.version;
  await fixture.admin.query("update crm_saved_views set version=version+1 where id=(select saved_view_id from newsletter_segments where id=$1)", [stale.id]);
  await expect(renameAudienceGroup(fixture.db, owner, tenant, stale.id, { name: "Renamed stale", version: staleVersion })).rejects.toMatchObject({ status: 409, details: { code: "GROUP_STALE" } });
  await expect(deleteAudienceGroup(fixture.db, owner, tenant, stale.id, { version: staleVersion })).rejects.toMatchObject({ status: 409, details: { code: "GROUP_STALE" } });
  expect((await fixture.admin.query("select archived_at from newsletter_segments where id=$1", [stale.id])).rows[0].archived_at).toBeNull();
  await expect(withTenant(fixture.db, owner, tenant, "newsletter:read", (tx, id) => selectionPins(tx, id, { listIds: [], segmentIds: [stale.id] }))).rejects.toMatchObject({ status: 404 });
  // A removed view takes the group with it (cascade); nothing is left to archive.
  const gone = await createGroupFromFilter(fixture.db, owner, tenant, { name: "Gone view", state });
  await fixture.admin.query("delete from crm_saved_views where id=(select saved_view_id from newsletter_segments where id=$1)", [gone.id]);
  expect((await audienceOverview(fixture.db, owner, tenant)).groups.map((g) => g.id)).not.toContain(gone.id);
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
  const segment = await fixture.admin.query("select is_nullable from information_schema.columns where table_name='newsletter_segments' and column_name='archived_at'");
  expect(segment.rows).toEqual([{ is_nullable: "YES" }]);
});
