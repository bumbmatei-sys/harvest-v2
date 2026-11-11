import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity, getPublicCommunity, myCommunities, updateMyApplication } from "../../src/server/community-joining";
import { decideApplication, listApplications } from "../../src/server/community-applications";
import type { Question } from "../../src/lib/questions";

// PR 4a services: questions and rules in the editor, open join with answers, applications and decisions.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, club: string;
const people = ["q-owner", "q-viewer", "q-b-owner", "q-open", "q-apply", "q-decline", "q-withdraw"];
const questions: Question[] = [
  { id: "aaaaaaaa", type: "short", label: "City", required: true },
  { id: "bbbbbbbb", type: "choice", label: "Member?", required: true, options: ["Yes", "No"] },
];
const answers = { aaaaaaaa: " Cluj ", bbbbbbbb: "Yes" };
async function edit(changes: Record<string, unknown>) {
  const { version } = await getCommunity(f.db, "q-owner", a, club);
  return updateCommunity(f.db, "q-owner", a, club, { version, ...changes });
}
const join = (user: string, extra: Record<string, unknown> = {}) => enterCommunity(f.db, user, "prayer-club", { rulesVersion: 1, questionsVersion: 1, answers, adult: true, ...extra });
const queue = async () => (await listApplications(f.db, "q-owner", a, club)).applications;

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "q-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "q-b-owner", "Other", "creator")).tenantId;
  await putMember(f.db, "q-owner", a, "q-viewer@example.test", "viewer");
  club = (await createCommunity(f.db, "q-owner", a, { name: "Prayer club", slug: "prayer-club" })).id;
  await edit({ visibility: "listed", allowOpen: true, rulesList: ["Be kind.", "Pray daily."], joinQuestions: questions });
  const { version } = await getCommunity(f.db, "q-owner", a, club);
  await publishCommunity(f.db, "q-owner", a, club, { version, published: true });
});
afterAll(async () => { await f?.close(); });

it("stores rules and questions with their versions and exposes them on the public page", async () => {
  expect(await getPublicCommunity(f.db, "prayer-club")).toMatchObject({ rulesList: ["Be kind.", "Pray daily."], rulesVersion: 1, joinQuestions: questions, questionsVersion: 1 });
  await expect(edit({ joinQuestions: [{ id: "BAD", type: "short", label: "x", required: false }] })).rejects.toThrow();
  await expect(edit({ rulesList: Array.from({ length: 21 }, (_, i) => `Rule ${i}`) })).rejects.toThrow();
  // Editing something else keeps both versions.
  await edit({ tagline: "Weekly" });
  expect(await getPublicCommunity(f.db, "prayer-club")).toMatchObject({ rulesVersion: 1, questionsVersion: 1 });
});

it("joins openly with trimmed answers and refuses invalid or stale ones", async () => {
  await expect(join("q-open", { answers: { aaaaaaaa: "Cluj" } })).rejects.toMatchObject({ status: 400 });
  await expect(join("q-open", { questionsVersion: 0 })).rejects.toMatchObject({ status: 409 });
  expect(await join("q-open")).toEqual({ outcome: "joined" });
  expect((await f.admin.query("select join_answers from community_memberships where user_id = 'q-open'")).rows[0].join_answers).toEqual({ aaaaaaaa: "Cluj", bbbbbbbb: "Yes" });
});

it("queues applications when approval is on, and the owner can ask for more information with a private note", async () => {
  await edit({ allowApply: true });
  expect(await join("q-apply")).toEqual({ outcome: "applied" });
  await expect(join("q-apply")).rejects.toMatchObject({ status: 409 });
  const [pending] = await queue();
  expect(pending).toMatchObject({ name: "q-apply", status: "pending", answers: { aaaaaaaa: "Cluj", bbbbbbbb: "Yes" } });
  await expect(decideApplication(f.db, "q-owner", a, club, pending.id, { action: "request_info" })).rejects.toThrow();
  await decideApplication(f.db, "q-owner", a, club, pending.id, { action: "request_info", message: "Which group?", note: "Knows the pastor" });
  const mine = (await myCommunities(f.db, "q-apply")).applications;
  expect(mine).toEqual([expect.objectContaining({ status: "info_requested", infoRequest: "Which group?" })]);
  expect(JSON.stringify(mine)).not.toContain("Knows the pastor");
});

it("lets the applicant resubmit or withdraw, and the owner decline", async () => {
  await f.admin.query("delete from community_applications");
  await f.admin.query("delete from community_memberships where user_id = 'q-apply'");
  expect(await join("q-apply")).toEqual({ outcome: "applied" });
  const [first] = await queue();
  await decideApplication(f.db, "q-owner", a, club, first.id, { action: "request_info", message: "Which group?" });
  await expect(updateMyApplication(f.db, "q-decline", first.id, { action: "withdraw" })).rejects.toMatchObject({ status: 404 });
  expect(await updateMyApplication(f.db, "q-apply", first.id, { action: "resubmit", questionsVersion: 1, answers: { aaaaaaaa: "Iasi", bbbbbbbb: "No" } })).toEqual({ outcome: "updated" });
  expect((await queue())[0]).toMatchObject({ status: "pending", infoRequest: null, answers: { aaaaaaaa: "Iasi", bbbbbbbb: "No" }, reviewerNote: null });
  expect(await decideApplication(f.db, "q-owner", a, club, first.id, { action: "approve" })).toEqual({ status: "approved" });
  expect((await f.admin.query("select role, status from community_memberships where user_id = 'q-apply'")).rows).toEqual([{ role: "member", status: "active" }]);
  expect((await f.admin.query("select source, granted_by from entitlements where user_id = 'q-apply'")).rows).toEqual([{ source: "application", granted_by: "q-owner" }]);
  await expect(decideApplication(f.db, "q-owner", a, club, first.id, { action: "decline" })).rejects.toMatchObject({ status: 409 });

  expect(await join("q-decline")).toEqual({ outcome: "applied" });
  const declined = (await queue()).find((x) => x.name === "q-decline")!;
  expect(await decideApplication(f.db, "q-owner", a, club, declined.id, { action: "decline", note: "Not a fit" })).toEqual({ status: "declined" });
  expect((await myCommunities(f.db, "q-decline")).applications).toEqual([expect.objectContaining({ status: "declined" })]);

  expect(await join("q-withdraw")).toEqual({ outcome: "applied" });
  const withdrawing = (await queue()).find((x) => x.name === "q-withdraw")!;
  expect(await updateMyApplication(f.db, "q-withdraw", withdrawing.id, { action: "withdraw" })).toEqual({ outcome: "updated" });
  await expect(decideApplication(f.db, "q-owner", a, club, withdrawing.id, { action: "approve" })).rejects.toMatchObject({ status: 409 });
  expect((await queue()).map((x) => x.name)).toEqual([]);
  expect((await listApplications(f.db, "q-owner", a, club, { status: "all" })).applications.map((x) => x.status).sort()).toEqual(["approved", "declined", "withdrawn"]);
});

it("refuses a banned person's approval and limits the queue to the community's managers", async () => {
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status) values ($1, $2, 'q-withdraw', 'member', 'banned') on conflict (tenant_id, community_id, user_id) do update set status = 'banned'", [a, club]);
  await f.admin.query(`insert into community_applications (tenant_id, community_id, user_id, status, questions_version, rules_version, adult_confirmed_at)
    values ($1, $2, 'q-withdraw', 'pending', 1, 1, now())`, [a, club]);
  const banned = (await queue()).find((x) => x.name === "q-withdraw")!;
  await expect(decideApplication(f.db, "q-owner", a, club, banned.id, { action: "approve" })).rejects.toMatchObject({ status: 409 });
  await expect(listApplications(f.db, "q-viewer", a, club)).rejects.toMatchObject({ status: 403 });
  await expect(decideApplication(f.db, "q-viewer", a, club, banned.id, { action: "decline" })).rejects.toMatchObject({ status: 403 });
  await expect(listApplications(f.db, "q-b-owner", a, club)).rejects.toMatchObject({ status: 403 });
  await expect(listApplications(f.db, "q-b-owner", b, club)).rejects.toMatchObject({ status: 404 });
  await expect(decideApplication(f.db, "q-b-owner", b, club, banned.id, { action: "decline" })).rejects.toMatchObject({ status: 404 });
});
