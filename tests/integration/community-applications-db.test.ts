import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { emailHash, emailHint, hashSecret, newInviteToken } from "../../src/lib/community-listing";

// PR 4a (migration 0037): answers validated in the database, approval queue, applicant actions, retention purge.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, club: string;
const people = ["p-owner", "p-b-owner", "p-one", "p-two", "p-three", "p-invited", "p-banned"];
const questions = [
  { id: "aaaaaaaa", type: "short", label: "City", required: true },
  { id: "bbbbbbbb", type: "choice", label: "Member?", required: true, options: ["Yes", "No"] },
  { id: "cccccccc", type: "checkboxes", label: "Interests", required: false, options: ["Prayer", "Study"] },
];
const good = { aaaaaaaa: "Cluj", bbbbbbbb: "Yes" };
const enter = (user: string, answers: unknown = good, qv = 1, hash: string | null = null) => withUser(f.db, user, async (tx) =>
  (await tx.execute<{ o: string }>(sql`select public.community_enter('prayer-club', 0, ${qv}, ${JSON.stringify(answers)}::jsonb, true, ${hash}, null) as o`)).rows[0].o);
const mine = (user: string) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: Record<string, unknown> }>(sql`select public.community_my_applications() as v`)).rows.map((r) => r.v));
const update = (user: string, id: string, action: string, answers: unknown = good, qv = 1) => withUser(f.db, user, async (tx) =>
  (await tx.execute<{ o: string }>(sql`select public.community_application_update(${id}::uuid, ${action}, ${JSON.stringify(answers)}::jsonb, ${qv}) as o`)).rows[0].o);

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "p-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "p-b-owner", "Other", "creator")).tenantId;
  club = (await createCommunity(f.db, "p-owner", a, { name: "Prayer club", slug: "prayer-club" })).id;
  await f.admin.query(`update communities set status = 'published', visibility = 'listed', allow_open = true, join_questions = $2::jsonb, questions_version = 1 where id = $1`,
    [club, JSON.stringify(questions)]);
});
afterAll(async () => { await f?.close(); });

it("validates answers against the current questions before an open join", async () => {
  expect(await enter("p-one", { aaaaaaaa: "Cluj" })).toBe("answers_invalid");
  expect(await enter("p-one", { ...good, bbbbbbbb: "Maybe" })).toBe("answers_invalid");
  expect(await enter("p-one", { ...good, cccccccc: ["Golf"] })).toBe("answers_invalid");
  expect(await enter("p-one", { ...good, zzzzzzzz: "x" })).toBe("answers_invalid");
  expect(await enter("p-one", { ...good, aaaaaaaa: "x".repeat(201) })).toBe("answers_invalid");
  expect(await enter("p-one", good, 0)).toBe("questions_changed");
  expect(await enter("p-one", { ...good, cccccccc: ["Study"] })).toBe("joined");
  expect((await f.admin.query("select join_answers from community_memberships where user_id = 'p-one'")).rows[0].join_answers).toEqual({ ...good, cccccccc: ["Study"] });
});

it("turns a request into one open application when approval is on, and lets the applicant withdraw or resubmit", async () => {
  await f.admin.query("update communities set allow_apply = true where id = $1", [club]);
  expect(await enter("p-two")).toBe("applied");
  expect(await enter("p-two")).toBe("already_applied");
  expect((await f.admin.query("select count(*)::int as n from community_memberships where user_id = 'p-two'")).rows[0].n).toBe(0);
  const [application] = await mine("p-two");
  expect(application).toMatchObject({ slug: "prayer-club", status: "pending", infoRequest: null, answers: good });
  expect(Object.keys(application)).not.toContain("reviewerNote");
  // Staff ask for more information and keep a private note; the applicant sees the request but never the note.
  await withTenant(f.db, "p-owner", a, "communities:manage", (tx) => tx.execute(sql`update community_applications set status = 'info_requested', info_request = 'Which group?', reviewer_note = 'Knows the pastor' where id = ${application.id}::uuid`));
  expect(await mine("p-two")).toEqual([expect.objectContaining({ status: "info_requested", infoRequest: "Which group?" })]);
  expect(JSON.stringify(await mine("p-two"))).not.toContain("Knows the pastor");
  expect(await update("p-three", application.id as string, "resubmit")).toBe("not_found");
  expect(await update("p-two", application.id as string, "resubmit", { aaaaaaaa: "Cluj" })).toBe("answers_invalid");
  expect(await update("p-two", application.id as string, "resubmit", { ...good, aaaaaaaa: "Iasi" })).toBe("updated");
  expect(await update("p-two", application.id as string, "resubmit")).toBe("invalid_state");
  expect(await mine("p-two")).toEqual([expect.objectContaining({ status: "pending", infoRequest: null, answers: { ...good, aaaaaaaa: "Iasi" } })]);
  expect(await update("p-two", application.id as string, "withdraw")).toBe("updated");
  expect(await mine("p-two")).toEqual([]);
  // After withdrawing, a new application is allowed.
  expect(await enter("p-two")).toBe("applied");
});

it("lets invitations skip the queue and refuses banned people", async () => {
  const token = newInviteToken();
  await f.admin.query(`insert into community_invites (tenant_id, community_id, email_hash, email_hint, token_hash, expires_at) values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [a, club, emailHash("p-invited@example.test"), emailHint("p-invited@example.test"), hashSecret(token)]);
  expect(await enter("p-invited", good, 1, hashSecret(token))).toBe("joined");
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status) values ($1, $2, 'p-banned', 'member', 'banned')", [a, club]);
  expect(await enter("p-banned")).toBe("banned");
  expect((await f.admin.query("select count(*)::int as n from community_applications where user_id = 'p-banned'")).rows[0].n).toBe(0);
});

it("keeps applications out of reach of applicants, members and other ministries", async () => {
  expect(await withUser(f.db, "p-two", async (tx) => (await tx.execute(sql`select * from community_applications`)).rows)).toEqual([]);
  expect(await withTenant(f.db, "p-b-owner", b, "communities:manage", async (tx) => (await tx.execute(sql`select * from community_applications`)).rows)).toEqual([]);
  // Staff cannot delete applications; only the retention purge does.
  await expect(withTenant(f.db, "p-owner", a, "communities:manage", (tx) => tx.execute(sql`delete from community_applications`))).rejects.toMatchObject({ cause: { code: "42501" } });
});

it("purges declined and withdrawn applications 90 days after the decision, and nothing else", async () => {
  await f.admin.query("update community_applications set decided_at = now() - interval '91 days' where user_id = 'p-two' and status = 'withdrawn'");
  await f.admin.query(`insert into community_applications (tenant_id, community_id, user_id, status, questions_version, rules_version, adult_confirmed_at, decided_at)
    values ($1, $2, 'p-three', 'declined', 1, 0, now(), now() - interval '89 days')`, [a, club]);
  const before = (await f.admin.query("select status from community_applications order by status")).rows.map((r) => r.status);
  const removed = await f.db.transaction(async (tx) => (await tx.execute<{ n: number }>(sql`select public.community_purge_applications() as n`)).rows[0].n);
  expect(removed).toBe(1);
  const after = (await f.admin.query("select status from community_applications order by status")).rows.map((r) => r.status);
  expect(after).toEqual(before.filter((status, i) => !(status === "withdrawn" && i === before.indexOf("withdrawn"))));
  expect(after).toContain("declined");
  expect(after).toContain("pending");
});
