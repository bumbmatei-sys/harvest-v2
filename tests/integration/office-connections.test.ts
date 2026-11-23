import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";
import { listOfficeConnections, type OfficeDeps } from "../../src/server/office-provider/connections";
import { FakeOfficeProvider } from "../../src/server/office-provider/fake-provider";
import { grant, type OfficeAccount, type OfficePlatform } from "../../src/server/office-provider/port";
import { OfficeMailReview } from "../../src/server/office-provider/review";
import { runOffice } from "../../src/server/office-provider/service";
import type { ConnectionKind } from "../../src/server/office-provider/types";
import { createContact, eraseContact } from "../../src/server/contacts";
import { mergeContacts, previewMerge } from "../../src/server/crm-merge";
import { withUser } from "../../src/server/tenancy";

vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>, people: Awaited<ReturnType<typeof seedPeople>>;
let otherAdmin: string;
let time = new Date("2026-11-21T12:00:00Z");
const now = () => time;
const credential = { secret: "office-provider-secret-canary" };
const provider = new FakeOfficeProvider(credential.secret, now);
const deps: OfficeDeps = { now, provider, credential, review: new OfficeMailReview(now) };
const mailSubject = "office-mail-subject-canary", mailBody = "office-mail-body-canary";
const address = "office-address-canary@example.test", eventTitle = "office-event-title-canary";
const contactId = randomUUID(), otherContact = randomUUID();
const legacyMinistry = randomUUID(), legacyId = randomUUID(), legacyOwner = "office-legacy-owner";
const upgradeAdmin = "office-upgrade-admin";
const upgradeDriveId = randomUUID(), upgradeOneDriveId = randomUUID(), upgradeAttemptId = randomUUID();
let fetchSpy: ReturnType<typeof noNetwork>;

beforeAll(async () => {
  fetchSpy = noNetwork();
  f = await testDatabase({ migrationOwner: true, beforeOfficeMigration: async db => {
    await db.query("insert into users(id,name,email) values($1,$1,$2)", [legacyOwner, `${legacyOwner}@example.test`]);
    await db.query("insert into workspaces(tenant_id,name,created_by) values($1,'Earlier ministry',$2)", [legacyMinistry, legacyOwner]);
    await db.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'owner')", [legacyMinistry, legacyOwner]);
    await db.query(`insert into office_connections(tenant_id,id,owner_user_id,kind,provider,external_account_ref,credential_envelope)
      values ($1,$2,$3,'mail','fake','legacy-account',
        '{"version":1,"keyId":"legacy","binding":"legacy","iv":"legacy","tag":"legacy","ciphertext":"legacy-envelope-canary"}')`,
    [legacyMinistry, legacyId, legacyOwner]);
  }, beforeOfficeFilesMigration: async db => {
    await db.query("insert into users(id,name,email) values($1,$1,$2)", [upgradeAdmin, `${upgradeAdmin}@example.test`]);
    await db.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin')", [legacyMinistry, upgradeAdmin]);
    await db.query(`insert into office_connections(tenant_id,id,owner_user_id,kind,provider,external_account_ref,platform,profile_ref,notice_version,health,grants)
      values ($1,$2,$3,'files','fake','upgrade-drive','google','upgrade-google-profile',1,'healthy',4),
             ($1,$4,$5,'files','fake','upgrade-onedrive','microsoft','upgrade-microsoft-profile',1,'healthy',4)`,
    [legacyMinistry, upgradeDriveId, legacyOwner, upgradeOneDriveId, upgradeAdmin]);
    await db.query(`insert into office_connect_attempts(tenant_id,owner_user_id,id,kind,platform,connection_id,provider,profile_ref,handoff_ref,notice_version,expires_at)
      values ($1,$2,$3,'files','google',$4,'fake','upgrade-google-profile','upgrade-handoff',1,$5)`,
    [legacyMinistry, legacyOwner, upgradeAttemptId, upgradeDriveId, new Date(now().getTime() + 60_000)]);
  } });
  people = await seedPeople(f, "office");
  otherAdmin = "office-admin-two";
  await f.admin.query("insert into users(id,name,email) values($1,$1,$2)", [otherAdmin, `${otherAdmin}@example.test`]);
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin')", [people.tenant, otherAdmin]);
  await f.admin.query("insert into contacts(tenant_id,id,name) values($1,$2,'Existing contact'),($3,$4,'Other contact')",
    [people.tenant, contactId, people.other, otherContact]);
}, 90_000);
afterAll(async () => {
  try { expect(fetchSpy).not.toHaveBeenCalled(); } finally { fetchSpy?.mockRestore(); await f?.close(); }
});

const request = (action: string, input: object = {}, connectionId?: string) => ({ action, input, connectionId });
const run = (action: string, input: object = {}, id?: string, actor = people.admin, tenant = people.tenant, selected = deps) =>
  runOffice(f.db, actor, tenant, request(action, input, id), selected);
async function start(kind: ConnectionKind, platform: OfficePlatform, actor: string, tenant: string, connectionId?: string) {
  const result = await run("startConnect", { kind, platform, noticeVersion: 1 }, connectionId, actor, tenant);
  expect(result).toMatchObject({ state: "pending", url: null });
  if (!("attemptId" in result)) throw new Error("Expected connect attempt");
  return result.attemptId;
}
async function connect(kind: ConnectionKind, platform: OfficePlatform, actor = people.admin, tenant = people.tenant) {
  const attemptId = await start(kind, platform, actor, tenant);
  const result = await run("finishConnect", { attemptId }, undefined, actor, tenant);
  expect(result).toMatchObject({ state: "connected", connection: { kind, platform, grants: grant[kind], noticeVersion: 1 } });
  if (!("connection" in result) || !result.connection) throw new Error("Expected connection");
  const { id } = result.connection;
  const { rows: [row] } = await f.admin.query("select external_account_ref, profile_ref from office_connections where tenant_id=$1 and id=$2", [tenant, id]);
  return { id, account: { kind, platform, ref: row.external_account_ref, profileRef: row.profile_ref } satisfies OfficeAccount };
}

it("upgrades populated Files connections and handoffs as a restricted migration owner", async () => {
  expect(f.migrationOwner).toBeTruthy();
  for (const [actor, id, platform] of [[legacyOwner, upgradeDriveId, "google"], [upgradeAdmin, upgradeOneDriveId, "microsoft"]]) {
    const { connections } = await listOfficeConnections(f.db, actor, legacyMinistry, deps);
    expect(connections.filter(row => row.kind === "files")).toMatchObject([{ id, platform, grants: 4, health: "healthy", noticeVersion: 1 }]);
  }
  const pending = await f.admin.query("select id, connection_id, platform from office_connect_attempts where tenant_id=$1", [legacyMinistry]);
  expect(pending.rows).toEqual([{ id: upgradeAttemptId, connection_id: upgradeDriveId, platform: "google" }]);
  const second = await connect("files", "microsoft", legacyOwner, legacyMinistry);
  expect((await listOfficeConnections(f.db, legacyOwner, legacyMinistry, deps)).connections
    .filter(row => row.kind === "files").map(row => row.id)).toEqual(expect.arrayContaining([upgradeDriveId, second.id]));
});

it("connects, lists, checks and disconnects each drive independently", async () => {
  const google = await connect("files", "google");
  const microsoft = await connect("files", "microsoft");
  for (const { id, account } of [google, microsoft]) {
    const file = { ref: `root-${account.platform}`, name: `${account.platform}.txt`, kind: "file" as const,
      parentRef: null, mimeType: "text/plain", size: 7, webUrl: null };
    provider.seed(credential, account, { files: [file] });
    expect(await run("files", {}, id)).toMatchObject({ state: "available", data: { items: [file] } });
    expect(await run("health", {}, id)).toMatchObject({ state: "available", data: { id, health: "healthy" } });
    await expect(run("startConnect", { kind: "files", platform: account.platform, noticeVersion: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(run("files", {}, id, otherAdmin)).rejects.toMatchObject({ status: 404 });
    await expect(run("health", {}, id, otherAdmin)).rejects.toMatchObject({ status: 404 });
    await expect(run("disconnect", {}, id, otherAdmin)).rejects.toMatchObject({ status: 404 });
  }
  const overview = await listOfficeConnections(f.db, people.admin, people.tenant, deps);
  expect(overview.connections).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: google.id, kind: "files", platform: "google" }),
    expect.objectContaining({ id: microsoft.id, kind: "files", platform: "microsoft" }),
  ]));
  expect(overview.connections).toHaveLength(2);
  expect((await listOfficeConnections(f.db, otherAdmin, people.tenant, deps)).connections).toEqual([]);
  await withUser(f.db, otherAdmin, async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${people.tenant}, true)`);
    expect((await tx.execute(sql`select id from office_connections where kind='files'`)).rows).toEqual([]);
    expect((await tx.execute(sql`select id from audit_logs where action like 'office.%'`)).rows).toEqual([]);
  });
  const insertConnection = (actor: string, ref: string) => f.admin.query(
    `insert into office_connections(tenant_id,owner_user_id,kind,provider,external_account_ref,platform,profile_ref,notice_version)
     values ($1,$2,'files','fake',$3,'microsoft','alternate-profile',1)`, [people.tenant, actor, ref]);
  await expect(insertConnection(people.admin, "alternate-account")).rejects.toMatchObject({
    code: "23505", constraint: "office_connection_personal_files_platform_idx",
  });
  await expect(insertConnection(otherAdmin, google.account.ref)).rejects.toMatchObject({
    code: "23505", constraint: "office_connection_provider_account_idx",
  });
  const reconnectId = await start("files", "google", people.admin, people.tenant, google.id);
  expect(await run("finishConnect", { attemptId: reconnectId })).toMatchObject({ state: "connected", connection: { id: google.id } });
  expect(await run("disconnect", {}, google.id)).toEqual({ state: "disconnected" });
  await expect(run("files", {}, google.id)).rejects.toMatchObject({ status: 404 });
  expect(await run("files", {}, microsoft.id)).toMatchObject({ state: "available", data: { items: [{ ref: "root-microsoft" }] } });
  expect((await listOfficeConnections(f.db, people.admin, people.tenant, deps)).connections).toMatchObject([{ id: microsoft.id }]);
  const audit = await f.admin.query(`select action, target_id, metadata from audit_logs where action in ('office.health','office.disconnect')
    and target_id=any($1) order by action, target_id`, [[google.id, microsoft.id]]);
  expect(audit.rows).toEqual(expect.arrayContaining([
    { action: "office.health", target_id: google.id, metadata: { outcome: "healthy" } },
    { action: "office.health", target_id: microsoft.id, metadata: { outcome: "healthy" } },
    { action: "office.disconnect", target_id: google.id, metadata: { outcome: "disconnected" } },
  ]));
  expect(audit.rows).toHaveLength(3);
  await run("disconnect", {}, microsoft.id);
});

it("keeps pending Files handoffs for different platforms independent", async () => {
  const google = await start("files", "google", people.admin, people.tenant);
  const microsoft = await start("files", "microsoft", people.admin, people.tenant);
  const latestGoogle = await start("files", "google", people.admin, people.tenant);
  await expect(run("finishConnect", { attemptId: google })).rejects.toMatchObject({ status: 404 });
  for (const [attemptId, platform] of [[microsoft, "microsoft"], [latestGoogle, "google"]]) {
    const result = await run("finishConnect", { attemptId });
    expect(result).toMatchObject({ state: "connected", connection: { platform } });
    if (!("connection" in result) || !result.connection) throw new Error("Expected connection");
    await run("disconnect", {}, result.connection.id);
  }
});

it("migrates a legacy connection to zero grants and replaces it only after a personal handoff", async () => {
  const before = await listOfficeConnections(f.db, legacyOwner, legacyMinistry, deps);
  expect(before.connections.filter(row => row.kind === "mail")).toMatchObject([{ id: legacyId, grants: 0, health: "reconnect_needed", noticeVersion: null }]);
  expect(await run("threads", {}, legacyId, legacyOwner, legacyMinistry)).toEqual({ state: "reconnect_needed" });
  const attemptId = await start("mail", "google", legacyOwner, legacyMinistry, legacyId);
  expect(await run("finishConnect", { attemptId }, undefined, legacyOwner, legacyMinistry)).toMatchObject({
    state: "connected", connection: { id: expect.not.stringMatching(legacyId), noticeVersion: 1, health: "healthy" },
  });
  expect(JSON.stringify((await f.admin.query("select * from office_connections where tenant_id=$1", [legacyMinistry])).rows)).not.toContain("legacy-envelope-canary");
  await expect(run("threads", {}, legacyId, legacyOwner, legacyMinistry)).rejects.toMatchObject({ status: 404 });
});

it("binds OAuth completion and every connection to the actor, even within one ministry", async () => {
  const attemptId = await start("mail", "google", people.admin, people.tenant);
  for (const actor of [people.owner, otherAdmin, people.member, people.viewer, people.outsider]) {
    await expect(run("finishConnect", { attemptId }, undefined, actor)).rejects.toMatchObject({ status: 404 });
  }
  await expect(run("finishConnect", { attemptId }, undefined, people.outsider, people.other)).rejects.toMatchObject({ status: 404 });
  const result = await run("finishConnect", { attemptId });
  if (!("connection" in result) || !result.connection) throw new Error("Expected connection");
  const { id } = result.connection;
  await expect(run("finishConnect", { attemptId })).rejects.toMatchObject({ status: 404 });
  const other = await connect("mail", "microsoft", otherAdmin);
  const foreign = await connect("mail", "google", people.outsider, people.other);
  for (const actor of [people.owner, otherAdmin, people.member, people.viewer, people.outsider]) {
    await expect(run("threads", {}, id, actor)).rejects.toMatchObject({ status: 404 });
    await expect(run("disconnect", {}, id, actor)).rejects.toMatchObject({ status: 404 });
  }
  await expect(run("threads", {}, foreign.id)).rejects.toMatchObject({ status: 404 });
  expect((await listOfficeConnections(f.db, otherAdmin, people.tenant, deps)).connections.map(row => row.id)).toEqual([other.id]);
  expect((await listOfficeConnections(f.db, people.owner, people.tenant, deps)).connections).toEqual([]);
  await expect(run("startConnect", { kind: "mail", platform: "google", noticeVersion: 0 })).rejects.toMatchObject({ name: "ZodError" });
  await expect(runOffice(f.db, people.admin, people.tenant, request("threads", {}, id), null)).rejects.toMatchObject({ status: 404 });
  await run("disconnect", {}, id);
});

it("passes mail and drafts through live, even after saved marker changes", async () => {
  const { id, account } = await connect("mail", "google");
  const mail = { ref: "message-personal", threadRef: "thread-personal", subject: mailSubject, body: mailBody, from: address, to: [address], labelRefs: ["inbox"] };
  expect(await run("threads", {}, id)).toEqual({ state: "available", data: { items: [], nextCursor: null } });
  provider.seed(credential, account, { messages: [mail] });
  const read = await run("thread", { threadRef: mail.threadRef }, id);
  expect(read).toMatchObject({ state: "available", data: { subject: mailSubject, messages: [{ body: mailBody }], marker: { read: false, starred: false } } });
  expect(await run("threads", { search: mailBody, folderRef: "inbox" }, id)).toMatchObject({ data: { items: [{ ref: mail.threadRef }] } });
  expect(await run("folders", {}, id)).toMatchObject({ data: { items: [{ ref: "inbox" }, { ref: "archive" }] } });
  expect(await run("labels", {}, id)).toMatchObject({ data: { items: [{ ref: "important" }] } });
  await expect(run("marker", { threadRef: mail.threadRef, contactId: otherContact }, id)).rejects.toMatchObject({ status: 404 });
  expect(await run("marker", { threadRef: mail.threadRef, read: true, contactId }, id)).toMatchObject({ data: { read: true, contactId } });
  expect(await run("marker", { threadRef: mail.threadRef, starred: true }, id)).toMatchObject({ data: { read: true, starred: true, contactId } });
  provider.seed(credential, account, { messages: [{ ...mail, body: "changed-office-mail-body-canary" }] });
  expect(await run("thread", { threadRef: mail.threadRef }, id)).toMatchObject({
    data: { messages: [{ body: "changed-office-mail-body-canary" }], marker: { read: true, starred: true, contactId } },
  });
  const content = { to: [address], subject: mailSubject, body: mailBody };
  const draft = await run("createDraft", { content, requestId: randomUUID() }, id);
  expect(draft).toMatchObject({ state: "available", data: content });
  if (draft.state !== "available" || !("data" in draft)) throw new Error("Expected draft");
  const { ref: draftRef, version } = draft.data as { ref: string; version: string };
  expect(await run("draft", { draftRef }, id)).toMatchObject({ data: { body: mailBody, version } });
  await run("updateDraft", { draftRef, version, content: { ...content, body: "changed-office-mail-body-canary" } }, id);
  await expect(run("updateDraft", { draftRef, version, content }, id)).rejects.toMatchObject({ status: 409 });
  expect(await run("drafts", {}, id)).toMatchObject({ data: { items: [{ ref: draftRef, body: "changed-office-mail-body-canary" }] } });
  await run("deleteDraft", { draftRef }, id);
  await expect(run("draft", { draftRef }, id)).rejects.toMatchObject({ status: 404 });
});

it("serves calendar availability and file references without keeping content or granting sharing", async () => {
  const cal = await connect("calendar", "microsoft");
  const files = await connect("files", "google");
  const start = "2026-11-22T10:00:00Z", end = "2026-11-22T11:00:00Z";
  const calendarEvent = { ref: "event-personal", title: eventTitle, description: "office-event-description-canary", start, end,
    attendees: [address], meetingLink: "https://meeting.example.test/transient", calendarRef: "primary", meetingKind: "teams" as const };
  provider.seed(credential, cal.account, { events: [calendarEvent] });
  provider.seed(credential, files.account, { files: [
    { ref: "folder", name: "Folder", kind: "folder", parentRef: null, mimeType: null, size: null, webUrl: null },
    { ref: "file-personal", name: "document.txt", kind: "file", parentRef: "folder", mimeType: "text/plain", size: 7, webUrl: "https://view.example.test/transient" },
  ] });
  expect(await run("calendars", {}, cal.id)).toMatchObject({ data: { items: [{ ref: "primary" }] } });
  expect(await run("events", { start, end }, cal.id)).toMatchObject({ data: { items: [calendarEvent] } });
  expect(await run("event", { eventRef: calendarEvent.ref }, cal.id)).toMatchObject({ data: calendarEvent });
  expect(await run("freeBusy", { start, end }, cal.id)).toMatchObject({ data: { items: [{ start: "2026-11-22T10:00:00.000Z" }] } });
  expect(await run("availability", { start, end, durationMinutes: 30 }, cal.id)).toMatchObject({ data: { items: [] } });
  expect(await run("eventLink", { eventRef: calendarEvent.ref, contactId }, cal.id)).toMatchObject({ data: { kind: "event", name: null } });
  for (const q of [request("createEvent", { calendarRef: "primary", requestId: randomUUID(), event: { start, end, title: eventTitle, attendees: [address] } }, cal.id),
    request("updateEvent", { eventRef: calendarEvent.ref, calendarRef: "primary", version: "seed", event: { start, end, title: eventTitle, attendees: [address] } }, cal.id),
    request("deleteEvent", { eventRef: calendarEvent.ref, calendarRef: "primary", version: "seed" }, cal.id)]) {
    expect(await runOffice(f.db, people.admin, people.tenant, q, deps)).toEqual({ state: "disabled" });
  }
  expect(await run("drives", {}, files.id)).toMatchObject({ data: { items: [{ ref: "root" }] } });
  expect(await run("files", {}, files.id)).toMatchObject({ data: { items: [{ ref: "folder" }] } });
  expect(await run("files", { folderRef: "folder", search: "document" }, files.id)).toMatchObject({ data: { items: [{ ref: "file-personal" }] } });
  expect(await run("picker", {}, files.id)).toMatchObject({ data: { mode: "inline" } });
  expect(await run("preview", { fileRef: "file-personal" }, files.id)).toMatchObject({ data: { url: "https://view.example.test/transient" } });
  expect(await run("downloadLink", { fileRef: "file-personal" }, files.id)).toMatchObject({ data: { url: "https://download.example.test/file-personal" } });
  expect(await run("fileLink", { fileRef: "file-personal", contactId }, files.id)).toMatchObject({ data: { ref: "file-personal", name: "document.txt" } });
  expect(await run("contactReferences", { contactId }, files.id)).toMatchObject({ data: { items: [{ ref: "file-personal", name: "document.txt" }] } });
  await expect(run("contactReferences", { contactId }, files.id, otherAdmin)).rejects.toMatchObject({ status: 404 });
  const document = JSON.stringify((await f.admin.query(`select
    (select json_agg(t) from office_connections t) as connections,
    (select json_agg(t) from office_connect_attempts t) as attempts,
    (select json_agg(t) from office_thread_markers t) as markers,
    (select json_agg(t) from office_contact_references t) as office_refs,
    (select json_agg(t) from audit_logs t where action like 'office.%') as audit,
    (select count(*)::int from contact_consents) as consents,
    (select count(*)::int from contacts) as contacts`)).rows);
  for (const canary of [mailSubject, mailBody, address, eventTitle, "office-event-description-canary", "transient", credential.secret,
    "changed-office-mail-body-canary", "credential_envelope"]) expect(document).not.toContain(canary);
  expect(JSON.parse(document)[0]).toMatchObject({ consents: 0, contacts: 2 });
  expect(await run("removeReference", { contactId, itemRef: "file-personal" }, files.id)).toMatchObject({ data: { removed: true } });
  const ms = await connect("files", "microsoft", otherAdmin);
  expect(await run("picker", {}, ms.id, otherAdmin)).toEqual({ state: "unavailable" });
  expect(await run("files", {}, ms.id, otherAdmin)).toEqual({ state: "available", data: { items: [], nextCursor: null } });
  await run("disconnect", {}, ms.id, otherAdmin);
});

it("requires an unexpired one-shot review bound to the exact message, even for test delivery", async () => {
  const { id } = await connect("mail", "microsoft", people.owner);
  const content = { subject: "Reviewed subject", body: "office-send-body-canary", to: [address] };
  const sender = vi.spyOn(provider, "simulateDelivery");
  const injected: OfficeDeps = { ...deps, testDelivery: true };
  expect(await run("reviewMail", { content }, id, people.owner)).toEqual({ state: "disabled" });
  expect(await run("sendMail", { content, reviewToken: randomUUID() }, id, people.owner)).toEqual({ state: "disabled" });
  const issue = async () => {
    const result = await run("reviewMail", { content }, id, people.owner, people.tenant, injected);
    expect(result).toMatchObject({ state: "available", data: { reviewToken: expect.any(String) } });
    if (result.state !== "available" || !("data" in result)) throw new Error("Expected review token");
    return (result.data as { reviewToken: string }).reviewToken;
  };
  const expired = await issue();
  time = new Date(time.getTime() + 5 * 60_000);
  await expect(run("sendMail", { content, reviewToken: expired }, id, people.owner, people.tenant, injected)).rejects.toMatchObject({ status: 409 });
  const reviewToken = await issue();
  await expect(run("sendMail", { content: { ...content, body: "changed" }, reviewToken }, id, people.owner, people.tenant, injected)).rejects.toMatchObject({ status: 409 });
  expect(sender).not.toHaveBeenCalled();
  expect(await run("sendMail", { content, reviewToken }, id, people.owner, people.tenant, injected)).toMatchObject({ state: "available" });
  await expect(run("sendMail", { content, reviewToken }, id, people.owner, people.tenant, injected)).rejects.toMatchObject({ status: 409 });
  expect(sender).toHaveBeenCalledTimes(1);
  const audit = JSON.stringify((await f.admin.query("select * from audit_logs where action like 'office.%'")).rows);
  for (const sensitive of [reviewToken, expired, content.body, content.subject, address]) expect(audit).not.toContain(sensitive);
});

it("refreshes reconnect-needed health and removes personal references on disconnect", async () => {
  const original = (await listOfficeConnections(f.db, people.admin, people.tenant, deps)).connections.find(row => row.kind === "mail");
  if (!original) throw new Error("Missing fixture account");
  const { rows: [row] } = await f.admin.query("select external_account_ref, profile_ref from office_connections where id=$1", [original.id]);
  const account = { ref: row.external_account_ref, profileRef: row.profile_ref, platform: "google", kind: "mail" } as const;
  const owner = people.admin;
  provider.setHealth(credential, account, { health: "reconnect_needed", grants: 0 });
  expect(await run("health", {}, original.id)).toMatchObject({ data: { health: "reconnect_needed", grants: 0 } });
  expect(await run("threads", {}, original.id)).toEqual({ state: "reconnect_needed" });
  const attemptId = await start("mail", "google", owner, people.tenant, original.id);
  expect(await run("finishConnect", { attemptId })).toMatchObject({ state: "connected", connection: { id: original.id, health: "healthy" } });
  expect(await run("disconnect", {}, original.id)).toEqual({ state: "disconnected" });
  await expect(run("threads", {}, original.id)).rejects.toMatchObject({ status: 404 });
  expect((await f.admin.query("select thread_ref from office_thread_markers where connection_id=$1", [original.id])).rows).toEqual([]);
});

it("enforces personal ownership and composite references through direct SQL and restricted owner", async () => {
  const { id } = await connect("mail", "google");
  const context = (actor: string, tenant: string, query: ReturnType<typeof sql>) =>
    withUser(f.db, actor, async tx => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant}, true)`);
      return tx.execute(query);
    });
  for (const [actor, tenant] of [[otherAdmin, people.tenant], [people.owner, people.tenant], [people.admin, people.other], [people.member, people.tenant]]) {
    const result = await context(actor, tenant, sql`select id from office_connections where id=${id}`);
    expect(result.rows).toEqual([]);
    expect((await context(actor, tenant, sql`select id from audit_logs where action like 'office.%' and target_id=${id}`)).rows).toEqual([]);
    expect((await context(actor, tenant, sql`delete from office_connections where id=${id} returning id`)).rows).toEqual([]);
  }
  await expect(context(people.admin, people.tenant, sql`update office_connections set owner_user_id=${otherAdmin} where id=${id}`)).rejects.toBeTruthy();
  await expect(context(people.admin, people.tenant, sql`insert into office_thread_markers(tenant_id, owner_user_id, connection_id, thread_ref, contact_id)
    values (${people.tenant}, ${people.admin}, ${id}, 'other contact', ${otherContact})`)).rejects.toBeTruthy();
  await expect(context(otherAdmin, people.tenant, sql`insert into office_thread_markers(tenant_id, owner_user_id, connection_id, thread_ref)
    values (${people.tenant}, ${otherAdmin}, ${id}, 'other owner')`)).rejects.toBeTruthy();
  await expect(context(people.admin, people.tenant, sql`insert into audit_logs(tenant_id, actor_id, action, target_id, metadata)
    values (${people.tenant}, ${people.admin}, 'office.threads', ${id}, jsonb_build_object('outcome','available','body',${mailBody}::text))`)).rejects.toBeTruthy();
  await f.admin.query("update workspace_members set role_id='member' where tenant_id=$1 and user_id=$2", [people.tenant, people.admin]);
  expect((await context(people.admin, people.tenant, sql`select id from office_connections`)).rows).toEqual([]);
  await expect(run("threads", {}, id)).rejects.toMatchObject({ status: 404 });

  const tables = ["office_connections", "office_connect_attempts", "office_thread_markers", "office_contact_references"];
  const forced = await f.admin.query("select relrowsecurity and relforcerowsecurity as forced from pg_class where relname=any($1)", [tables]);
  expect(forced.rows).toEqual(tables.map(() => ({ forced: true })));
  await f.admin.query(`SET ROLE ${f.migrationOwner}`);
  try {
    for (const table of tables) expect((await f.admin.query(`select * from ${table}`)).rows).toEqual([]);
  } finally { await f.admin.query("RESET ROLE"); }
});

it.each(["erase", "merge"] as const)("cleans another admin's private Office links on contact %s", async action => {
  const { owner, tenant } = people;
  const source = await createContact(f.db, owner, tenant, { name: "Source contact" });
  const target = await createContact(f.db, owner, tenant, { name: "Kept contact" });
  const files = await connect("files", "microsoft", otherAdmin);
  const calendar = await connect("calendar", "microsoft", otherAdmin);
  const mail = await connect("mail", "microsoft", otherAdmin);
  const suffixes = [`${action}-source`, `${action}-target`];
  provider.seed(credential, files.account, { files: suffixes.map(ref => ({
    ref, name: `${ref}.txt`, kind: "file", parentRef: null, mimeType: "text/plain", size: 7, webUrl: null,
  })) });
  provider.seed(credential, calendar.account, { events: suffixes.map(ref => ({
    ref, title: "Private appointment", start: "2026-11-22T10:00:00Z", end: "2026-11-22T11:00:00Z",
    calendarRef: "primary", attendees: [], meetingLink: null,
  })) });
  provider.seed(credential, mail.account, { messages: suffixes.map(threadRef => ({
    threadRef, ref: `message-${threadRef}`, subject: mailSubject, body: mailBody, from: address, to: [address], labelRefs: ["inbox"],
  })) });
  for (const [index, person] of [source, target].entries()) {
    const ref = suffixes[index];
    expect(await run("fileLink", { fileRef: ref, contactId: person.id }, files.id, otherAdmin)).toMatchObject({
      data: { ref, name: `${ref}.txt` },
    });
    expect(await run("eventLink", { eventRef: ref, contactId: person.id }, calendar.id, otherAdmin)).toMatchObject({
      data: { ref, startsAt: new Date("2026-11-22T10:00:00Z"), endsAt: new Date("2026-11-22T11:00:00Z") },
    });
    expect(await run("marker", { threadRef: ref, contactId: person.id, read: true, starred: true }, mail.id, otherAdmin))
      .toMatchObject({ data: { ref, contactId: person.id, read: true, starred: true } });
  }

  // Forging the trigger's transaction setting does not grant the caller access.
  await withUser(f.db, owner, async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant}, true), set_config('app.office_erasure_contact', ${source.id}, true)`);
    expect((await tx.execute(sql`delete from public.office_contact_references where contact_id = ${source.id} returning item_ref`)).rows).toEqual([]);
    expect((await tx.execute(sql`update public.office_thread_markers set contact_id = null where contact_id = ${source.id} returning thread_ref`)).rows).toEqual([]);
  });

  if (action === "erase") {
    expect(await eraseContact(f.db, owner, tenant, source.id)).toEqual({ erased: true });
  } else {
    const preview = await previewMerge(f.db, owner, tenant, target.id, source.id);
    expect(await mergeContacts(f.db, owner, tenant, target.id, {
      sourceId: source.id, targetVersion: preview.kept.version, sourceVersion: preview.merged.version,
    })).toMatchObject({ id: target.id });
  }
  expect((await f.admin.query("select id from contacts where tenant_id=$1 and id=$2", [tenant, source.id])).rows).toEqual([]);
  const references = await f.admin.query(`select contact_id, item_ref, kind, name, starts_at, ends_at
    from office_contact_references where tenant_id=$1 and item_ref=any($2) order by kind`, [tenant, suffixes]);
  expect(references.rows).toEqual([
    { contact_id: target.id, item_ref: suffixes[1], kind: "event", name: null,
      starts_at: new Date("2026-11-22T10:00:00Z"), ends_at: new Date("2026-11-22T11:00:00Z") },
    { contact_id: target.id, item_ref: suffixes[1], kind: "file", name: `${suffixes[1]}.txt`, starts_at: null, ends_at: null },
  ]);
  const markers = await f.admin.query(`select thread_ref, contact_id, read, starred
    from office_thread_markers where tenant_id=$1 and thread_ref=any($2) order by thread_ref`, [tenant, suffixes]);
  expect(markers.rows).toEqual([
    { thread_ref: suffixes[0], contact_id: null, read: true, starred: true },
    { thread_ref: suffixes[1], contact_id: target.id, read: true, starred: true },
  ]);
  await run("disconnect", {}, files.id, otherAdmin);
});
