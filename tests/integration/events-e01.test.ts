import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { withTenant } from "../../src/server/tenancy";
import { dispatchOutbox } from "../../src/server/jobs/outbox";
import { downloadEvent, eventJoinLink, eventReminderCandidates, eventRoster, getEvent, listEvents, rsvpEvent, saveEvent, setEventPlacement, transitionEvent } from "../../src/server/events";

const people = ["event-owner", "event-admin", "event-member", "event-viewer", "reader-a", "reader-b", "other-owner"];
const url = "https://meeting.example.test/private";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, other: string, community: string, backup: string, foreignCommunity: string;
const when = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const input = (times: { startsAt: string; endsAt: string } = { startsAt: when(15), endsAt: when(90) }) => ({
  ...times, version: 0, title: "Test event", description: "An example, no invitation.",
  timeZone: "America/New_York", capacity: 1, joinUrl: url,
});

beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values(people.map(id => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, "event-owner", "Events ministry", "church")).tenantId;
  other = (await createWorkspace(fixture.db, "other-owner", "Other ministry", "creator")).tenantId;
  await putMember(fixture.db, "event-owner", tenant, "event-admin@example.test", "admin");
  await putMember(fixture.db, "event-owner", tenant, "event-member@example.test", "member");
  await putMember(fixture.db, "event-owner", tenant, "event-viewer@example.test", "viewer");
  community = (await createCommunity(fixture.db, "event-owner", tenant, { name: "Events circle", slug: "events-circle" })).id;
  backup = (await createCommunity(fixture.db, "event-owner", tenant, { name: "Backup circle", slug: "backup-circle" })).id;
  foreignCommunity = (await createCommunity(fixture.db, "other-owner", other, { name: "Other circle", slug: "other-circle" })).id;
  await fixture.admin.query("update communities set status='published' where id=any($1::uuid[])", [[community, backup, foreignCommunity]]);
});
afterAll(async () => { vi.unstubAllEnvs(); await fixture?.close(); });

async function admission(circle: string, user: string, until: string | null = null) {
  await fixture.admin.query(`insert into community_memberships (tenant_id,community_id,user_id,status)
    values ($1,$2,$3,'active') on conflict (tenant_id,community_id,user_id) do update set status='active'`, [tenant, circle, user]);
  const grant = randomUUID();
  await fixture.admin.query(`insert into entitlements (tenant_id,id,user_id,resource_type,resource_id,source,valid_until)
    values ($1,$2,$3,'community',$4,'admin_grant',$5)`, [tenant, grant, user, circle, until]);
  return grant;
}
async function attach(id: string, circle: string) {
  await fixture.admin.query("insert into community_event_links(tenant_id,event_id,community_id) values ($1,$2,$3)", [tenant, id, circle]);
}
async function create({ circle = community, times }: { circle?: string; times?: { startsAt: string; endsAt: string } } = {}) {
  const id = randomUUID();
  expect(await saveEvent(fixture.db, "event-owner", tenant, id, input(times))).toMatchObject({ event: { status: "draft", version: 1 } });
  await attach(id, circle);
  expect(await transitionEvent(fixture.db, "event-owner", tenant, id, { action: "publish", version: 1 })).toMatchObject({ status: "published", version: 2 });
  return id;
}
const rsvp = (actor: string, id: string, state = "going", expectedVersion = 0) => rsvpEvent(fixture.db, actor, tenant, id, { state, expectedVersion });
const summary = (actor: string, id: string) => getEvent(fixture.db, actor, tenant, id);
const missing = { status: 404 };

it("forces RLS and grants no broad tenant or provider path", async () => {
  const id = await create();
  const rules = await fixture.admin.query(`select relname,relrowsecurity,relforcerowsecurity
    from pg_class where relname in ('events','event_join_links','event_rsvps','community_event_links')`);
  expect(rules.rows).toHaveLength(4);
  expect(rules.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  await expect(attach(id, foreignCommunity)).rejects.toMatchObject({ code: "23503" });
  await expect(eventRoster(fixture.db, "event-admin", tenant, id, null)).resolves.toEqual([]);
  await expect(eventRoster(fixture.db, "event-admin", other, id, null)).rejects.toMatchObject(missing);
  for (const user of ["event-member", "event-viewer"]) {
    await expect(withTenant(fixture.db, user, tenant, "workspace:read", (tx) =>
      tx.execute(sql`select url from public.event_join_links where event_id=${id}::uuid`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withTenant(fixture.db, user, tenant, "workspace:read", async (tx) =>
      (await tx.execute<{ result: { outcome: string } }>(sql`select public.events_operate(${tenant}::uuid,${id}::uuid,'get','{}') result`)).rows[0].result))
      .resolves.toEqual({ outcome: "not_found" });
    await expect(eventRoster(fixture.db, user, tenant, id, null)).rejects.toMatchObject(missing);
  }
  await expect(getEvent(fixture.db, "other-owner", tenant, id)).rejects.toMatchObject(missing);
  await expect(getEvent(fixture.db, "event-owner", other, id)).rejects.toMatchObject(missing);
  await expect(saveEvent(fixture.db, "event-viewer", tenant, id, input())).rejects.toMatchObject(missing);
  expect(await listEvents(fixture.db, "event-viewer", tenant, { from: when(0), to: when(120) })).toEqual([]);
});

it("locks a single remaining place, deduplicates retries and rejects stale updates", async () => {
  const id = await create();
  await admission(community, "reader-a");
  await admission(community, "reader-b");
  // Each RSVP must use a different physical connection to exercise the event row lock.
  const pool = new Pool({ connectionString: fixture.appURL, max: 2 });
  const parallel = drizzle(pool, { schema });
  const entries = await Promise.all(["reader-a", "reader-b"].map(user => rsvpEvent(parallel, user, tenant, id, { state: "going", expectedVersion: 0 })))
    .finally(() => pool.end());
  expect(entries.map(entry => entry.outcome).sort()).toEqual(["full", "ok"]);
  const winner = entries[0].outcome === "ok" ? "reader-a" : "reader-b";
  const loser = winner === "reader-a" ? "reader-b" : "reader-a";
  expect(await rsvp(winner, id)).toMatchObject({ outcome: "ok", event: { available: 0, rsvp: "going" } });
  expect(await rsvp(loser, id, "maybe")).toMatchObject({ outcome: "ok", event: { available: 0, rsvp: "maybe" } });
  expect(await rsvp(loser, id, "going", 1)).toEqual({ outcome: "full" });
  expect(await summary(loser, id)).toMatchObject({ rsvp: "maybe" });
  await expect(saveEvent(fixture.db, "event-owner", tenant, id, { ...input(), version: 1 })).rejects.toMatchObject({ status: 409 });
  expect(await eventRoster(fixture.db, "event-owner", tenant, id, null)).toHaveLength(2);
  const outbox = (await fixture.admin.query("select kind,payload from outbox_events where payload->>'eventId'=$1", [id])).rows;
  expect(outbox.filter(row => row.kind === "events.rsvp")).toHaveLength(2);
  expect(JSON.stringify(outbox)).not.toContain("reader-a");
  expect(JSON.stringify(outbox)).not.toContain(url);
  expect(await withTenant(fixture.db, "event-owner", tenant, "jobs:operate", tx => dispatchOutbox(tx, tenant, 100))).toBe(0);
});

it("drops bookings on access loss without resurrecting them on rejoin, while another original link can keep a seat", async () => {
  const id = await create();
  await attach(id, backup);
  await admission(community, "reader-a");
  const secondary = await admission(backup, "reader-a");
  await admission(community, "reader-b");
  expect((await rsvp("reader-a", id)).outcome).toBe("ok");
  await fixture.admin.query("update community_memberships set status='left' where community_id=$1 and user_id='reader-a'", [community]);
  expect(await summary("reader-a", id)).toMatchObject({ rsvp: "going" });
  await fixture.admin.query("update entitlements set revoked_at=now() where tenant_id=$1 and id=$2", [tenant, secondary]);
  expect(await summary("reader-b", id)).toMatchObject({ available: 1 });
  await admission(community, "reader-a");
  expect(await summary("reader-a", id)).toMatchObject({ rsvp: null });
  expect((await rsvp("reader-b", id)).outcome).toBe("ok");
});

it("releases an expired grant and suppresses a private URL outside the join window or after cancellation", async () => {
  const near = await create();
  const far = await create({ times: { startsAt: when(90), endsAt: when(150) } });
  await fixture.admin.query("update entitlements set revoked_at=now() where tenant_id=$1 and resource_id=$2 and user_id='reader-a' and revoked_at is null", [tenant, community]);
  const limited = await admission(community, "reader-a", when(1));
  expect(await eventJoinLink(fixture.db, "reader-a", tenant, near)).toEqual({ url });
  await expect(eventJoinLink(fixture.db, "reader-a", tenant, far)).rejects.toMatchObject(missing);
  expect(await eventJoinLink(fixture.db, "event-owner", tenant, far, true)).toEqual({ url });
  expect(JSON.stringify(await summary("reader-a", near))).not.toContain(url);
  expect(await (await downloadEvent(fixture.db, "reader-a", tenant, near)).text()).not.toContain(url);
  expect((await rsvp("reader-a", near)).outcome).toBe("ok");
  await fixture.admin.query("update entitlements set valid_from=now() - interval '2 days', valid_until=now() - interval '1 day' where tenant_id=$1 and id=$2", [tenant, limited]);
  await expect(eventJoinLink(fixture.db, "reader-a", tenant, near)).rejects.toMatchObject(missing);
  expect(await summary("reader-b", near)).toMatchObject({ available: 1 });
  expect(await transitionEvent(fixture.db, "event-owner", tenant, near, { action: "cancel", version: 2 })).toMatchObject({ status: "cancelled", version: 3 });
  expect(await transitionEvent(fixture.db, "event-owner", tenant, near, { action: "cancel", version: 2 })).toMatchObject({ status: "cancelled", version: 3 });
  await expect(eventJoinLink(fixture.db, "reader-b", tenant, near)).rejects.toMatchObject(missing);
  expect(await (await downloadEvent(fixture.db, "reader-b", tenant, near)).text()).toContain("STATUS:CANCELLED");
});

it("rechecks eligibility after waiting for a concurrent ban and preserves capacity", async () => {
  const id = await create();
  await admission(community, "reader-a");
  const writes = await fixture.admin.connect();
  const pool = new Pool({ connectionString: fixture.appURL, application_name: "events-e01-ban-race" });
  const parallel = drizzle(pool, { schema });
  try {
    await writes.query("begin");
    await writes.query("update community_memberships set status='banned' where community_id=$1 and user_id='reader-a'", [community]);
    const pending = rsvpEvent(parallel, "reader-a", tenant, id, { state: "going", expectedVersion: 0 });
    // Observe the actual database wait instead of assuming request timing.
    let blocked = false;
    const deadline = Date.now() + 3000;
    while (!blocked && Date.now() < deadline) {
      const activity = await writes.query("select pg_stat_clear_snapshot()");
      expect(activity.rowCount).toBe(1);
      blocked = (await writes.query("select 1 from pg_stat_activity where application_name='events-e01-ban-race' and wait_event_type='Lock'")).rowCount === 1;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
    }
    await writes.query("commit");
    await expect(pending).rejects.toMatchObject(missing);
    expect(blocked).toBe(true);
    expect(await summary("reader-b", id)).toMatchObject({ available: 1 });
  } finally {
    await writes.query("rollback");
    writes.release();
    await pool.end();
  }
});

it("keeps never-published cancellations private and rejects a stale RSVP retry", async () => {
  const draft = randomUUID();
  await saveEvent(fixture.db, "event-owner", tenant, draft, input());
  await attach(draft, community);
  await admission(community, "reader-a");
  await transitionEvent(fixture.db, "event-owner", tenant, draft, { action: "cancel", version: 1 });
  await expect(summary("reader-a", draft)).rejects.toMatchObject(missing);
  const id = await create();
  expect(await rsvp("reader-a", id)).toMatchObject({ event: { rsvpVersion: 1 } });
  expect(await rsvp("reader-a", id, "not_going", 1)).toMatchObject({ event: { rsvpVersion: 2 } });
  await expect(rsvp("reader-a", id, "going", 0)).rejects.toMatchObject({ status: 409 });
  expect(await summary("reader-a", id)).toMatchObject({ rsvp: "not_going", available: 1 });
});

it("does not revive a released reservation when a community is republished", async () => {
  const id = await create();
  await attach(id, backup);
  await admission(community, "reader-a");
  await admission(backup, "reader-b");
  expect((await rsvp("reader-a", id)).outcome).toBe("ok");
  await fixture.admin.query("update communities set status='draft' where id=$1", [community]);
  expect((await rsvp("reader-b", id)).outcome).toBe("ok");
  await fixture.admin.query("update communities set status='published' where id=$1", [community]);
  expect(await summary("reader-a", id)).toMatchObject({ available: 0, rsvp: null, rsvpVersion: 1 });
  expect(await summary("reader-b", id)).toMatchObject({ available: 0, rsvp: "going" });
});

it("reserves released seats for eligible FIFO claimants without reviving an old queue entry", async () => {
  const id = await create({ circle: backup });
  await admission(backup, "event-member");
  const firstGrant = await admission(backup, "reader-a");
  await admission(backup, "reader-b");
  await rsvp("event-member", id);
  expect(await rsvp("reader-a", id, "waitlisted")).toMatchObject({ event: { rsvp: "waitlisted", rsvpVersion: 1, canClaimSeat: false } });
  expect(await rsvp("reader-b", id, "waitlisted")).toMatchObject({ event: { rsvp: "waitlisted" } });
  expect(await rsvp("reader-a", id, "waitlisted")).toMatchObject({ event: { rsvpVersion: 1 } });
  await rsvp("event-member", id, "not_going", 1);
  expect(await rsvp("event-member", id, "going", 2)).toEqual({ outcome: "full" });
  expect(await rsvp("reader-b", id, "going", 1)).toEqual({ outcome: "full" });
  expect(await summary("reader-a", id)).toMatchObject({ available: 0, canClaimSeat: true });
  await fixture.admin.query("update entitlements set revoked_at=now() where id=$1", [firstGrant]);
  await admission(backup, "reader-a");
  expect(await summary("reader-a", id)).toMatchObject({ rsvp: null, canClaimSeat: false });
  expect(await rsvp("reader-a", id, "waitlisted", 1)).toMatchObject({ event: { rsvpVersion: 2, canClaimSeat: false } });
  expect(await rsvp("reader-b", id, "going", 1)).toMatchObject({ event: { rsvp: "going", available: 0 } });
});

it("returns due reminder candidates only for eligible Going members through the manager definer", async () => {
  const id = await create({ circle: backup });
  await admission(backup, "reader-a");
  await admission(backup, "reader-b");
  const lead = 20;
  await saveEvent(fixture.db, "event-owner", tenant, id, { ...input(), version: 2, reminderMinutes: lead });
  await rsvp("reader-b", id);
  await rsvp("reader-a", id, "waitlisted");
  const due = () => eventReminderCandidates(fixture.db, "event-owner", tenant, id, null);
  expect(await due()).toEqual([expect.objectContaining({ userId: "reader-b", eventVersion: 3, rsvpVersion: 1 })]);
  expect(await eventReminderCandidates(fixture.db, "event-admin", tenant, id, null)).toEqual(await due());
  await expect(eventReminderCandidates(fixture.db, "event-admin", other, id, null)).rejects.toMatchObject(missing);
  expect(await eventReminderCandidates(fixture.db, "event-owner", tenant, id, "reader-b")).toEqual([]);
  expect(JSON.stringify(await due())).not.toContain(url);
  for (const actor of ["event-member", "event-viewer"]) {
    await expect(withTenant(fixture.db, actor, tenant, "workspace:read", async (tx) =>
      (await tx.execute<{ result: { outcome: string } }>(
        sql`select public.events_operate(${tenant}::uuid,${id}::uuid,'reminder_candidates','{}') result`)).rows[0].result))
      .resolves.toEqual({ outcome: "not_found" });
    await expect(withTenant(fixture.db, actor, tenant, "workspace:read", (tx) =>
      tx.execute(sql`select waitlisted_at from public.event_rsvps where event_id=${id}::uuid`)))
      .rejects.toMatchObject({ cause: { code: "42501" } });
  }
  await fixture.admin.query("update community_memberships set notifications_muted=true where community_id=$1 and user_id='reader-b'", [backup]);
  expect(await due()).toEqual([]);
  await fixture.admin.query("update community_memberships set notifications_muted=false where community_id=$1 and user_id='reader-b'", [backup]);
  await saveEvent(fixture.db, "event-owner", tenant, id, { ...input(), version: 3, reminderMinutes: 5 });
  expect(await due()).toEqual([]);
  await transitionEvent(fixture.db, "event-owner", tenant, id, { version: 4, action: "cancel" });
  expect(await due()).toEqual([]);
});

it("links and unlinks only same-ministry events for current managers, with idempotent audits", async () => {
  const id = randomUUID();
  await saveEvent(fixture.db, "event-owner", tenant, id, input());
  await admission(community, "reader-a");
  for (const user of ["reader-a", "event-member", "event-viewer", "other-owner"]) {
    await expect(setEventPlacement(fixture.db, user, tenant, id, community, true)).rejects.toMatchObject(missing);
  }
  await expect(setEventPlacement(fixture.db, "event-admin", tenant, id, foreignCommunity, true)).rejects.toMatchObject(missing);
  await expect(setEventPlacement(fixture.db, "event-admin", tenant, randomUUID(), community, true)).rejects.toMatchObject(missing);

  const pools = [new Pool({ connectionString: fixture.appURL }), new Pool({ connectionString: fixture.appURL })];
  try {
    expect(await Promise.all(pools.map((pool, i) =>
      setEventPlacement(drizzle(pool, { schema }), i ? "event-admin" : "event-owner", tenant, id, community, true))))
      .toEqual([{ linked: true }, { linked: true }]);
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
  }
  await expect(summary("reader-a", id)).rejects.toMatchObject(missing);
  await transitionEvent(fixture.db, "event-owner", tenant, id, { action: "publish", version: 1 });
  expect((await rsvp("reader-a", id)).outcome).toBe("ok");
  expect(await setEventPlacement(fixture.db, "event-admin", tenant, id, community, false)).toEqual({ linked: false });
  expect(await setEventPlacement(fixture.db, "event-admin", tenant, id, community, false)).toEqual({ linked: false });
  await expect(summary("reader-a", id)).rejects.toMatchObject(missing);
  await setEventPlacement(fixture.db, "event-admin", tenant, id, community, true);
  expect(await summary("reader-a", id)).toMatchObject({ rsvp: null, available: 1 });
  const changes = await fixture.admin.query("select action, metadata from audit_logs where target_id=$1 and action in ('events.link_community','events.unlink_community') order by created_at", [id]);
  expect(changes.rows).toEqual(["link_community", "unlink_community", "link_community"].map(action =>
    ({ action: "events." + action, metadata: { communityId: community } })));
});

it("reads the saved join window only for managers and preserves omitted fields on edit", async () => {
  const id = randomUUID(), fields = input({ startsAt: when(120), endsAt: when(180) });
  await saveEvent(fixture.db, "event-owner", tenant, id, { ...fields, location: "Central hall, 42 Sample Road", joinWindowMinutes: 7 });
  await setEventPlacement(fixture.db, "event-owner", tenant, id, community, true);
  await transitionEvent(fixture.db, "event-owner", tenant, id, { action: "publish", version: 1 });
  await admission(community, "reader-a");
  expect(await summary("event-admin", id)).toMatchObject({ location: "Central hall, 42 Sample Road", waitlistEnabled: true, joinWindowMinutes: 7 });
  const saved = await saveEvent(fixture.db, "event-admin", tenant, id, { ...fields, version: 2, title: "Updated name" });
  expect(saved).toMatchObject({ event: { location: "Central hall, 42 Sample Road", joinWindowMinutes: 7 } });
  const view = await summary("reader-a", id);
  expect(view).toMatchObject({ location: "Central hall, 42 Sample Road", waitlistEnabled: true });
  expect(view).not.toHaveProperty("joinWindowMinutes");
  expect(view).not.toHaveProperty("joinUrl");
  await expect(eventJoinLink(fixture.db, "reader-a", tenant, id)).rejects.toMatchObject(missing);
  await expect(saveEvent(fixture.db, "event-owner", tenant, id, { ...fields, version: 3, location: "x".repeat(241) }))
    .rejects.toMatchObject({ name: "ZodError" });
  await expect(summary("reader-a", "malformed")).rejects.toMatchObject(missing);
});

it("preserves existing FIFO entries when closing the waitlist to new entries", async () => {
  const times = { startsAt: when(120), endsAt: when(180) };
  const id = await create({ times });
  for (const user of ["reader-a", "reader-b", "event-member"]) await admission(community, user);
  await rsvp("reader-a", id);
  const queued = await rsvp("reader-b", id, "waitlisted");
  expect(queued).toMatchObject({ event: { rsvp: "waitlisted", rsvpVersion: 1 } });

  await saveEvent(fixture.db, "event-admin", tenant, id, { ...input(times), version: 2, waitlistEnabled: false });
  expect(await summary("reader-b", id)).toMatchObject({ waitlistEnabled: false, rsvp: "waitlisted" });
  await expect(rsvp("event-member", id, "waitlisted")).rejects.toMatchObject({ status: 400 });
  await rsvp("reader-a", id, "not_going", 1);
  expect(await rsvp("event-member", id)).toEqual({ outcome: "full" });
  expect(await rsvp("reader-b", id, "going", 1)).toMatchObject({ event: { rsvp: "going" } });
});
