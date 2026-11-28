import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { seedYourData, ydPeople, ydStorage } from "../helpers/your-data-seed";
import { exportMyData, EXPORT_LINK_SECONDS } from "../../src/server/your-data";
import { withUser } from "../../src/server/tenancy";

// "Your data" (27 Nov), part 1: the export holds the caller's own rows.
// The fixture runs migrations as a non-superuser owner, so the definer's owner policies (FORCE RLS) are exercised for real.
let f: Awaited<ReturnType<typeof testDatabase>>, seed: Awaited<ReturnType<typeof seedYourData>>;
const { me, peer, outsider } = ydPeople;
type Export = Awaited<ReturnType<typeof exportMyData>>;
const rows = (data: Export, key: string) => (data as unknown as Record<string, Record<string, unknown>[]>)[key];

beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  f = await testDatabase({ migrationOwner: true });
  seed = await seedYourData(f.db, f.admin);
  await f.admin.query("insert into sessions(id, token, expires_at, ip_address, user_agent, user_id) values ('yd-s', 'yd-secret-token', now() + interval '1 day', '203.0.113.7', 'Synthetic browser', $1)", [me]);
  const { tenant, community, event, myPost, peerPost, file } = seed;
  const { rows: [{ item_id: item }] } = await f.admin.query("select item_id from catalog_enrolments where user_id = $1", [me]);
  await f.admin.query(`insert into catalog_reviews (tenant_id, item_id, user_id, rating, body, hidden_at, hidden_by) values
    ($1, $2, $3, 5, 'My synthetic course review', now(), $4), ($1, $2, $4, 1, 'Peer private review', null, null)`,
  [tenant, item, me, peer]);
  await f.admin.query("insert into community_post_details values ($1, $3, $4, $5), ($2, $3, $4, $6)",
    [myPost, peerPost, tenant, community, { location: "My public location", feeling: "joyful", photoIds: [file], mentionIds: [peer] },
      { location: "Peer private location", feeling: "sad" }]);
  await f.admin.query("insert into community_point_settings (tenant_id, community_id, enabled) values ($1, $2, true)", [tenant, community]);
  await f.admin.query("insert into community_points_hidden_members values ($1, $2, $3)", [tenant, community, me]);
  await f.admin.query("insert into community_event_links (tenant_id, event_id, community_id) values ($1, $2, $3)", [tenant, event, community]);
  await f.admin.query("insert into community_point_attendance values ($1, $2, $3, $4), ($1, $2, $3, $5)", [tenant, community, event, me, peer]);
  const challenge = randomUUID();
  await f.admin.query(`insert into community_challenges (tenant_id, community_id, id, title, starts_at, ends_at, goal, target)
    values ($1, $2, $3, 'Synthetic challenge', now(), now() + interval '1 day', 'post', 2)`, [tenant, community, challenge]);
  await f.admin.query(`insert into community_challenge_members (tenant_id, community_id, challenge_id, user_id) values
    ($1, $2, $3, $4), ($1, $2, $3, $5)`, [tenant, community, challenge, me, peer]);

  await f.admin.query("insert into workspace_members (tenant_id, user_id, role_id) values ($1, $2, 'viewer')", [tenant, peer]);
  const role = randomUUID(), slot = randomUUID(), rosterId = randomUUID();
  await f.admin.query("insert into volunteer_roles (tenant_id, id, name) values ($1, $2, 'Welcome team')", [tenant, role]);
  await f.admin.query(`insert into volunteer_slots (tenant_id, id, role_id, title, service_date, starts_at, ends_at, needed)
    values ($1, $2, $3, 'Synthetic service', current_date, now(), now() + interval '1 hour', 4)`, [tenant, slot, role]);
  await f.admin.query(`insert into volunteers (tenant_id, id, role_id, user_id, start_date, note)
    values ($1, $2, $3, $4, current_date, 'Private staff note')`, [tenant, rosterId, role, me]);
  await f.admin.query(`insert into volunteer_assignments (tenant_id, slot_id, role_id, user_id, volunteer_id)
    values ($1, $2, $3, null, $4), ($1, $2, $3, $5, null)`, [tenant, slot, role, rosterId, peer]);
  await f.admin.query("insert into volunteer_availability values ($1, $2, '2026-12-05'), ($1, $3, '2026-12-06')", [tenant, me, peer]);
  await f.admin.query(`insert into volunteer_requests (tenant_id, slot_id, user_id, replacement_user_id, kind)
    values ($1, $2, $3, $4, 'swap')`, [tenant, slot, peer, me]);

  await f.admin.query(`insert into ministry_payment_accounts (tenant_id, account_id, provider, legal_name, currency, country)
    values ($1, 'fake-your-data', 'fake', 'Synthetic ministry', 'EUR', 'DE')`, [tenant]);
  for (const [donor, amount] of [[me, 1234], [peer, 2345]] as const) {
    const intent = randomUUID(), ledger = randomUUID();
    await f.admin.query(`insert into ministry_payment_intents
      (tenant_id, id, payer_id, account_id, kind, cadence, amount_minor, currency, legal_name, request_key)
      values ($1, $2, $3, 'fake-your-data', 'donation', 'once', $4, 'EUR', 'Synthetic ministry', 'private-request-key')`,
    [tenant, intent, donor, amount]);
    await f.admin.query(`insert into ministry_payment_ledger
      (tenant_id, id, account_id, intent_id, object_ref, kind, amount_minor, currency, occurred_at)
      values ($1, $2, 'fake-your-data', $3, $2::uuid::text, 'charge', $4, 'EUR', now())`, [tenant, ledger, intent, amount]);
    await f.admin.query(`insert into ministry_donation_receipts
      (tenant_id, ledger_id, intent_id, donor_id, amount_minor, currency, paid_at, legal_name, personal_support, cadence)
      values ($1, $2, $3, $4, $5, 'EUR', now(), 'Synthetic ministry', false, 'once')`, [tenant, ledger, intent, donor, amount]);
  }
}, 120_000);
afterAll(async () => { await f?.close(); vi.unstubAllEnvs(); });

it("exports every section of the caller's own data", async () => {
  const data = await exportMyData(f.db, ydStorage, me, new Date("2026-11-27T10:00:00Z"));
  expect(data).toMatchObject({ format: "harvest-your-data", version: 1, account: { id: me, email: `${me}@example.invalid`, name: `Name ${me}` } });
  expect(rows(data, "ministries")).toEqual([expect.objectContaining({ ministry: "Grace Example Ministry", role: "viewer" })]);
  expect(rows(data, "communities")).toEqual([expect.objectContaining({ community: "Your data club", status: "active", role: "member" })]);
  expect(rows(data, "posts").map((row) => row.title)).toEqual(["My synthetic post"]);
  expect(rows(data, "replies").map((row) => row.text)).toEqual(["My synthetic reply"]);
  expect(rows(data, "chatMessages").map((row) => [row.channel, row.text])).toEqual([["General", "My synthetic chat"]]);
  expect(rows(data, "directMessages")).toEqual([expect.objectContaining({ text: "My synthetic DM", community: "Your data club" })]);
  expect(rows(data, "likes")).toEqual([expect.objectContaining({ type: "post", target: seed.peerPost })]);
  expect(rows(data, "reactions")).toEqual([expect.objectContaining({ emoji: "🙏", message: seed.peerMessage })]);
  expect(rows(data, "courseEnrolments")).toEqual([expect.objectContaining({ course: "Synthetic course" })]);
  expect(rows(data, "courseProgress")).toEqual([expect.objectContaining({ course: "Synthetic course", lesson: "Lesson one" })]);
  expect(rows(data, "courseNotes")).toEqual([expect.objectContaining({ lesson: "Lesson one", note: "My private synthetic note" })]);
  expect(rows(data, "events")).toEqual([expect.objectContaining({ event: "Synthetic gathering", answer: "going" })]);
  expect(rows(data, "access").map((row) => row.type).sort()).toEqual(["community", "course"]);
  // Files: metadata for both uploads; only the ready one has a signed link, valid for an hour; the storage key itself is never exported.
  const files = rows(data, "files");
  expect(files.map((row) => [row.name, row.status, row.link !== null])).toEqual([["notes.pdf", "ready", true], ["draft.pdf", "pending", false]]);
  expect(files[0]).toMatchObject({ link: expect.stringContaining(`expires=${EXPORT_LINK_SECONDS}`), linkExpiresAt: "2026-11-27T11:00:00.000Z" });
  expect(files.every((row) => !("key" in row))).toBe(true);
  expect(rows(data, "postDetails")).toEqual([{ postId: seed.myPost, location: "My public location", feeling: "joyful", photoIds: [seed.file], mentionIds: [peer] }]);
  expect(rows(data, "communityPoints")).toEqual([{ communityId: seed.community, lifetimePoints: 7 }]);
  expect(rows(data, "communityPointAttendance")).toEqual([{ communityId: seed.community, eventId: seed.event }]);
  expect(rows(data, "communityPointVisibility")).toEqual([{ communityId: seed.community, hidden: true }]);
  expect(rows(data, "communityChallenges")).toEqual([expect.objectContaining({ communityId: seed.community, title: "Synthetic challenge" })]);
  expect(rows(data, "volunteerRoles")).toHaveLength(1);
  expect(rows(data, "volunteerAssignments")).toHaveLength(1);
  expect(rows(data, "volunteerAvailability")).toEqual([{ ministryId: seed.tenant, unavailableDate: "2026-12-05" }]);
  expect(rows(data, "volunteerRequests")).toEqual([expect.objectContaining({ kind: "swap", participation: "replacement", acceptedAt: null })]);
  expect(rows(data, "donationReceipts")).toEqual([expect.objectContaining({ amountMinor: 1234, currency: "EUR" })]);
  expect(rows(data, "paymentIntents")).toEqual([expect.objectContaining({ amountMinor: 1234, currency: "EUR" })]);
  expect(rows(data, "catalogReviews")).toEqual([expect.objectContaining({ rating: 5, text: "My synthetic course review", hidden: true })]);
  const encoded = JSON.stringify(data);
  for (const detail of ["Peer private location", "Private staff note", "private-request-key", "fake-your-data", "Peer private review"]) {
    expect(encoded).not.toContain(detail);
  }
  expect(data.notes.truncated).toEqual([]);
  // Sign-in history: session times, address and browser; never the session token.
  expect(rows(data, "signIns")).toEqual([expect.objectContaining({ ipAddress: "203.0.113.7", userAgent: "Synthetic browser", signedInAt: expect.any(String) })]);
  expect(JSON.stringify(data)).not.toContain("yd-secret-token");
  // Connect intake is off in tests outside the synthetic mode, so the section says it is unavailable instead of failing the export.
  expect(data.consents).toHaveProperty("connectResponses");
});

it("omits other people’s names and private fields", async () => {
  const text = JSON.stringify(await exportMyData(f.db, ydStorage, me));
  for (const foreign of ["Peer synthetic post", "Peer synthetic reply", "Peer synthetic chat", "Peer synthetic DM", "Unrelated synthetic DM",
    "Peer private synthetic note", `${peer}@example.invalid`, `${outsider}@example.invalid`, `Name ${outsider}`, `Name ${peer}`, "maybe"]) expect(text).not.toContain(foreign);
  // The peer's own export is the mirror image.
  const theirs = JSON.stringify(await exportMyData(f.db, ydStorage, peer));
  expect(theirs).toContain("Peer synthetic DM");
  expect(theirs).not.toContain("My synthetic DM");
  expect(theirs).not.toContain("My private synthetic note");
});

it("limits exports to 3 per rolling hour per person and audits each one", async () => {
  await f.admin.query("delete from account_export_requests");
  for (let n = 0; n < 3; n++) await exportMyData(f.db, null, outsider);
  await expect(exportMyData(f.db, null, outsider)).rejects.toMatchObject({ status: 429, details: { code: "EXPORT_LIMITED" } });
  // Another person is not affected; an hour later the limit has rolled over.
  await expect(exportMyData(f.db, null, peer)).resolves.toBeTruthy();
  await f.admin.query("update account_export_requests set requested_at = now() - interval '61 minutes' where user_id = $1", [outsider]);
  await expect(exportMyData(f.db, null, outsider)).resolves.toBeTruthy();
  expect((await f.admin.query("select count(*)::int n from audit_logs where action = 'account.export' and actor_id = $1 and tenant_id is null", [outsider])).rows[0].n).toBe(4);
});

it("gives the app role no direct access to the request log and leaves no flag set afterwards", async () => {
  await expect(withUser(f.db, me, (tx) => tx.execute(sql`select * from account_export_requests`))).rejects.toThrow();
  const after = await withUser(f.db, me, async (tx) => {
    await tx.execute(sql`select public.account_export()`);
    return (await tx.execute<{ e: string; t: string }>(sql`select current_setting('app.account_export', true) e, current_setting('app.community_definer_tenant', true) t`)).rows[0];
  });
  expect(after).toEqual({ e: "", t: "" });
  // A flag the app sets itself opens nothing: the owner policies are owner-only, and the app role still reads no other person's notes.
  const forged = await withUser(f.db, peer, async (tx) => {
    await tx.execute(sql`select set_config('app.account_export', 'on', true)`);
    return (await tx.execute(sql`select body from catalog_notes`)).rows;
  });
  expect(forged).toEqual([{ body: "Peer private synthetic note" }]);
  // Unknown or signed-out callers get nothing.
  await expect(withUser(f.db, "nobody", (tx) => tx.execute(sql`select public.account_export() v`))).resolves.toMatchObject({ rows: [{ v: { outcome: "not_found" } }] });
});

it("blanks every app.* flag any owner-role policy reads (compared with pg_policies), and never reads pg_settings", async () => {
  const { rows: [fn] } = await f.admin.query("select prosrc from pg_proc where proname = 'account_self_reset'");
  const flags = (await f.admin.query(`select distinct m[1] as flag from pg_policies p, regexp_matches(coalesce(qual,'')||coalesce(with_check,''), '(app\\.[a-z0-9_]+)', 'g') m
    where not ('harvest_app' = any(p.roles))`)).rows.map((r) => r.flag as string);
  expect(flags.length).toBeGreaterThan(30);
  // app.user_id is the verified caller and is deliberately kept.
  expect(flags.filter((flag) => flag !== "app.user_id" && !fn.prosrc.includes(`'${flag}'`)).sort()).toEqual([]);
  for (const blog of ["app.blog_public_file", "app.blog_public_handle", "app.blog_public_tenant", "app.blog_publish"]) expect(fn.prosrc).toContain(`'${blog}'`);
  expect(fn.prosrc).not.toContain("pg_settings");
});
