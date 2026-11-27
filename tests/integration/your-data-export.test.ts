import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { seedYourData, ydPeople, ydStorage } from "../helpers/your-data-seed";
import { exportMyData, EXPORT_LINK_SECONDS } from "../../src/server/your-data";
import { withUser } from "../../src/server/tenancy";

// "Your data" (27 Nov), part 1: the export holds the caller's own rows and nothing of anyone else's beyond a DM counterpart's display name.
// The fixture runs migrations as a non-superuser owner, so the definer's owner policies (FORCE RLS) are exercised for real.
let f: Awaited<ReturnType<typeof testDatabase>>, seed: Awaited<ReturnType<typeof seedYourData>>;
const { me, peer, outsider } = ydPeople;
type Export = Awaited<ReturnType<typeof exportMyData>>;
const rows = (data: Export, key: string) => (data as unknown as Record<string, Record<string, unknown>[]>)[key];

beforeAll(async () => {
  vi.stubEnv("HARVEST_COMMUNITIES", "enabled");
  f = await testDatabase({ migrationOwner: true });
  seed = await seedYourData(f.db, f.admin);
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
  expect(rows(data, "directMessages")).toEqual([expect.objectContaining({ text: "My synthetic DM", to: `Name ${peer}`, community: "Your data club" })]);
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
  expect(data.notes.truncated).toEqual([]);
  // Connect intake is off in tests outside the synthetic mode, so the section says it is unavailable instead of failing the export.
  expect(data.consents).toHaveProperty("connectResponses");
});

it("never includes anyone else's data beyond a DM counterpart's display name", async () => {
  const text = JSON.stringify(await exportMyData(f.db, ydStorage, me));
  for (const foreign of ["Peer synthetic post", "Peer synthetic reply", "Peer synthetic chat", "Peer synthetic DM", "Unrelated synthetic DM",
    "Peer private synthetic note", `${peer}@example.invalid`, `${outsider}@example.invalid`, `Name ${outsider}`, "maybe"]) expect(text).not.toContain(foreign);
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
