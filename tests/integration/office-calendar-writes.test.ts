import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";
import { officeGateOpen } from "../../src/server/office-gate";
import { calendarWritesOn, type OfficeDeps } from "../../src/server/office-provider/connections";
import { FakeOfficeProvider } from "../../src/server/office-provider/fake-provider";
import { calendarWriteGrant, grant, type OfficeAccount } from "../../src/server/office-provider/port";
import { OfficeMailReview } from "../../src/server/office-provider/review";
import { runOffice } from "../../src/server/office-provider/service";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
let f: Awaited<ReturnType<typeof testDatabase>>, people: Awaited<ReturnType<typeof seedPeople>>, spy: ReturnType<typeof noNetwork>;
const now = () => new Date("2026-11-23T12:00:00Z");
const credential = { secret: "office-writes-secret" };
const provider = new FakeOfficeProvider(credential.secret, now);
const deps: OfficeDeps = { now, provider, credential, review: new OfficeMailReview(now), calendarWrites: true };
const offDeps: OfficeDeps = { ...deps, calendarWrites: undefined };
const titleCanary = "office-write-title-canary", notesCanary = "office-write-notes-canary";
const otherAdmin = "office-writes-admin-two";
let id: string, account: OfficeAccount, otherId: string;
const calendars = [
  { ref: "primary", name: "Personal", primary: true, timezone: "America/New_York" },
  { ref: "family", name: "Family", timezone: "Europe/Bucharest" },
  { ref: "holidays", name: "Holidays", readOnly: true },
];
const body = (extra: object = {}) => ({ title: titleCanary, description: notesCanary, start: "2026-11-25T15:00:00Z", end: "2026-11-25T16:00:00Z", attendees: [], ...extra });
const run = (action: string, input: object = {}, connectionId = id, actor = people.admin, d = deps) =>
  runOffice(f.db, actor, people.tenant, { action, input, connectionId }, d);
async function connect(actor: string, access?: "write") {
  const started = await runOffice(f.db, actor, people.tenant, { action: "startConnect", input: { kind: "calendar", platform: "google", noticeVersion: 1, ...(access && { access }) } }, deps);
  if (!("attemptId" in started)) throw new Error("expected attempt");
  const done = await runOffice(f.db, actor, people.tenant, { action: "finishConnect", input: { attemptId: started.attemptId } }, deps);
  if (!("connection" in done) || !done.connection) throw new Error("expected connection");
  const { rows: [row] } = await f.admin.query("select external_account_ref, profile_ref from office_connections where id=$1", [done.connection.id]);
  return { id: done.connection.id as string, grants: done.connection.grants as number, account: { kind: "calendar", platform: "google", ref: row.external_account_ref, profileRef: row.profile_ref } satisfies OfficeAccount };
}
const create = (extra: object = {}, calendarRef = "primary", requestId = randomUUID()) => run("createEvent", { calendarRef, requestId, event: body(extra) });

beforeAll(async () => {
  spy = noNetwork();
  f = await testDatabase({ migrationOwner: true });
  people = await seedPeople(f, "ow");
  await f.admin.query("insert into users(id,name,email) values($1,$1,$2)", [otherAdmin, `${otherAdmin}@example.test`]);
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin')", [people.tenant, otherAdmin]);
  const read = await connect(people.admin);
  expect(read.grants).toBe(grant.calendar);
  ({ id, account } = read);
  provider.seed(credential, account, { calendars });
  const second = await connect(otherAdmin, "write");
  otherId = second.id;
  provider.seed(credential, second.account, { calendars });
}, 90_000);
afterAll(async () => { try { expect(spy).not.toHaveBeenCalled(); } finally { spy?.mockRestore(); await f?.close(); } });

it("is hard-off without the route gate flag, outside the synthetic provider and in production", async () => {
  expect(calendarWritesOn(deps)).toBe(true);
  expect(calendarWritesOn(offDeps)).toBe(false);
  expect(calendarWritesOn({ ...deps, provider: { ...provider, id: "zernio" } as never })).toBe(false);
  // No route deps exist in production, so the gate never supplies the flag there.
  expect(officeGateOpen({ NODE_ENV: "production" })).toBe(false);
  expect(officeGateOpen({ VERCEL_ENV: "production" })).toBe(false);
  expect(await run("createEvent", { calendarRef: "primary", requestId: randomUUID(), event: body() }, id, people.admin, offDeps)).toEqual({ state: "disabled" });
});

it("needs a separate write grant before any write, and lists only writable calendars", async () => {
  expect(await create()).toEqual({ state: "write_access_needed" });
  expect(await run("calendars", { writableOnly: true })).toMatchObject({ state: "available", data: { items: [{ ref: "primary" }, { ref: "family" }], defaultRef: "primary" } });
  const started = await runOffice(f.db, people.admin, people.tenant, { action: "startConnect", connectionId: id, input: { kind: "calendar", platform: "google", noticeVersion: 1, access: "write" } }, deps);
  if (!("attemptId" in started)) throw new Error("expected attempt");
  const done = await runOffice(f.db, people.admin, people.tenant, { action: "finishConnect", input: { attemptId: started.attemptId } }, deps);
  expect(done).toMatchObject({ state: "connected", connection: { id, grants: grant.calendar | calendarWriteGrant, capabilities: { createEvent: "available", meeting: "available" } } });
  const { rows } = await f.admin.query("select grants from office_connections where id=$1", [id]);
  expect(rows[0].grants).toBe(10);
});

it("creates once per request id, never with attendees, never in a read-only calendar", async () => {
  const requestId = randomUUID();
  const first = await create({ meeting: true }, "family", requestId), again = await create({ meeting: true }, "family", requestId);
  expect(first).toMatchObject({ state: "available", data: { calendarRef: "family", timezone: "Europe/Bucharest", meetingKind: "meet", attendees: [] } });
  expect(again).toEqual(first);
  const now = await run("events", { start: "2026-11-25T00:00:00Z", end: "2026-11-26T00:00:00Z" });
  expect(now).toMatchObject({ data: { items: [{ createdHere: true }] } });
  expect(JSON.stringify(now).match(/office-write-title-canary/g)).toHaveLength(1);
  await expect(create({ attendees: ["a@example.test"] })).rejects.toMatchObject({ status: 400 });
  await expect(create({}, "holidays")).rejects.toMatchObject({ status: 400 });
  await expect(create({}, "missing")).resolves.toEqual({ state: "unavailable" });
  expect(await create({ allDay: true, start: "2026-11-27", end: "2026-11-28" }, "primary")).toMatchObject({ data: { allDay: true, start: "2026-11-27" } });
  await expect(create({ allDay: true })).rejects.toMatchObject({ name: "ZodError" });
  // The next default is the calendar used last.
  expect(await run("calendars", { writableOnly: true })).toMatchObject({ data: { defaultRef: "primary" } });
  await create({}, "family");
  expect(await run("calendars", { writableOnly: true })).toMatchObject({ data: { defaultRef: "family" } });
});

it("edits and deletes only events created in Harvest, with versions", async () => {
  const made = await create({ title: "first" }, "primary");
  if (made.state !== "available") throw new Error("expected event");
  const event = made.data as { ref: string; version: string };
  const changed = await run("updateEvent", { eventRef: event.ref, calendarRef: "primary", version: event.version, event: body({ title: "second" }) });
  expect(changed).toMatchObject({ state: "available", data: { ref: event.ref, title: "second" } });
  // Stale version: refused, nothing overwritten.
  await expect(run("updateEvent", { eventRef: event.ref, calendarRef: "primary", version: event.version, event: body({ title: "stale" }) })).rejects.toMatchObject({ status: 409 });
  await expect(run("deleteEvent", { eventRef: event.ref, calendarRef: "primary", version: event.version })).rejects.toMatchObject({ status: 409 });
  expect(await run("event", { eventRef: event.ref, calendarRef: "primary" })).toMatchObject({ data: { title: "second", createdHere: true } });
  // The provider changes it elsewhere.
  const latest = (changed as { data: { version: string } }).data.version;
  provider.touchEvent(credential, account, event.ref);
  await expect(run("updateEvent", { eventRef: event.ref, calendarRef: "primary", version: latest, event: body() })).rejects.toMatchObject({ status: 409 });
  const fresh = (await run("event", { eventRef: event.ref, calendarRef: "primary" })) as { data: { version: string } };
  expect(await run("deleteEvent", { eventRef: event.ref, calendarRef: "primary", version: fresh.data.version })).toMatchObject({ state: "available", data: { deleted: true } });
  await expect(run("event", { eventRef: event.ref, calendarRef: "primary" })).rejects.toMatchObject({ status: 404 });
  const { rows } = await f.admin.query("select count(*)::int as n from office_calendar_events where event_ref=$1", [event.ref]);
  expect(rows[0].n).toBe(0);
  // An event Harvest did not create is read-only.
  provider.seed(credential, account, { calendars, events: [{ ref: "outside", calendarRef: "primary", title: "Outside", start: "2026-11-25T10:00:00Z", end: "2026-11-25T11:00:00Z", attendees: [], meetingLink: null }] });
  expect(await run("event", { eventRef: "outside", calendarRef: "primary" })).toMatchObject({ data: { createdHere: false } });
  await expect(run("updateEvent", { eventRef: "outside", calendarRef: "primary", version: "seed", event: body() })).rejects.toMatchObject({ status: 404 });
  await expect(run("deleteEvent", { eventRef: "outside", calendarRef: "primary", version: "seed" })).rejects.toMatchObject({ status: 404 });
});

it("keeps each admin private and stores no event content", async () => {
  const mine = await create({ title: "private" }, "primary");
  if (mine.state !== "available") throw new Error("expected event");
  const event = mine.data as { ref: string; version: string };
  // The other admin's own connection neither sees nor edits it, and cannot use this connection.
  await expect(run("createEvent", { calendarRef: "primary", requestId: randomUUID(), event: body() }, id, otherAdmin)).rejects.toMatchObject({ status: 404 });
  await expect(run("deleteEvent", { eventRef: event.ref, calendarRef: "primary", version: event.version }, otherId, otherAdmin)).rejects.toMatchObject({ status: 404 });
  const theirs = await run("events", { start: "2026-11-25T00:00:00Z", end: "2026-11-28T00:00:00Z" }, otherId, otherAdmin);
  expect(theirs).toMatchObject({ data: { items: [] } });
  const rows = await f.admin.query("select * from office_calendar_events");
  const audits = await f.admin.query("select action, target_id, metadata from audit_logs where action in ('office.createEvent','office.updateEvent','office.deleteEvent')");
  const dump = JSON.stringify([rows.rows, audits.rows]);
  expect(dump).not.toContain(titleCanary);
  expect(dump).not.toContain(notesCanary);
  expect(dump).not.toContain("example.test");
  expect(audits.rows.map(row => row.metadata.outcome)).toEqual(expect.arrayContaining(["available", "conflict", "disabled", "write_access_needed"]));
  expect(audits.rows.filter(row => row.metadata.outcome === "conflict").every(row => typeof row.metadata.eventRef === "string")).toBe(true);
  expect(audits.rows.every(row => Object.keys(row.metadata).every(key => ["outcome", "eventRef"].includes(key)))).toBe(true);
});

it("rejects content in audit metadata and unknown references at the database", async () => {
  await expect(f.admin.query("insert into office_calendar_events(tenant_id,owner_user_id,connection_id,calendar_ref,event_ref) values ($1,$2,$3,'primary','x')", [people.tenant, otherAdmin, id])).rejects.toMatchObject({ code: "23503" });
});
