import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { saveEmailFrequency } from "../../src/server/community-notifications";
import { runCommunityEmail, unsubscribeByToken, withWorkerLock } from "../../src/server/community-email";
import { COMMUNITY_EMAIL_LIVE_DELIVERY, sendLiveCommunityEmail, testMailboxSender, type CommunityMail } from "../../src/server/community-email-sender";
import { verifyUnsubscribe } from "../../src/lib/community-email-token";

// C15b worker: queues, renders, sends to a local test mailbox, records results, never double-sends, unsubscribes by token.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, club: string, dir: string, mailbox: string;
const secret = "test-secret-that-is-long-enough", origin = "http://127.0.0.1:3100";
const people = ["w-owner", "w-one", "w-two", "w-applicant", "w-outsider"];
const run = () => runCommunityEmail(f.workerPool, testMailboxSender(mailbox), { origin, secret });
const mails = async () => (await readFile(mailbox, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as CommunityMail);
const notify = (user: string, kind: string, target: string, detail: object = {}, ageDays = 0) => f.admin.query(
  `insert into community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, detail, created_at, updated_at)
   values ($1, $2, $3, $4, $5, gen_random_uuid()::text, $6, now() - make_interval(days => $7), now() - make_interval(days => $7))`, [a, club, user, kind, target, JSON.stringify(detail), ageDays]);

beforeAll(async () => {
  f = await testDatabase();
  dir = await mkdtemp(join(tmpdir(), "harvest-community-email-"));
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "w-owner", "Grace Church", "church")).tenantId;
  club = (await createCommunity(f.db, "w-owner", a, { name: "Worker club", slug: "worker-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = $1", [club]);
  for (const user of ["w-one", "w-two"]) {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, 'member', 'active', now() - interval '1 hour')", [a, club, user]);
    await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [a, user, club]);
  }
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); await f?.close(); });
beforeEach(async () => {
  mailbox = join(dir, `mailbox-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeFile(mailbox, "");
  await f.admin.query("delete from community_email_deliveries; delete from community_notifications;");
  await f.admin.query("update community_memberships set email_frequency = 'important', email_digest_cursor = null");
});

it("sends instant and digest email to the test mailbox, once, with unsubscribe links", async () => {
  await notify("w-one", "warning", "warning");
  await notify("w-applicant", "application", "application", { status: "approved" });
  await saveEmailFrequency(f.db, "w-two", "worker-club", { frequency: "daily" });
  await f.admin.query("update community_memberships set email_digest_cursor = now() - interval '2 days' where user_id = 'w-two'");
  await notify("w-two", "reply", "comment", {}, 1);
  expect(await run()).toEqual({ queued: 3, sent: 3, failed: 0 });
  const sent = await mails();
  expect(sent.map((m) => m.to).sort()).toEqual(["w-applicant@example.test", "w-one@example.test", "w-two@example.test"]);
  const one = sent.find((m) => m.to === "w-one@example.test")!, digest = sent.find((m) => m.to === "w-two@example.test")!, applicant = sent.find((m) => m.to === "w-applicant@example.test")!;
  expect(one.subject).toBe("Worker club: You received a warning from the hosts");
  expect(digest.subject).toBe("Worker club: 1 update for you");
  expect(one.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  expect(applicant.headers).toEqual({});
  expect(applicant.text).toContain("Your application was approved");
  expect(new Set(sent.map((m) => m.idempotencyKey)).size).toBe(3);
  expect(await run()).toEqual({ queued: 0, sent: 0, failed: 0 });
  expect(await mails()).toHaveLength(3);
});

it("unsubscribes with the emailed link's token, and ignores a bad token the same way", async () => {
  await notify("w-one", "warning", "warning");
  await run();
  const [mail] = await mails();
  const token = mail.text.match(/#token=([\w.-]+)/)![1];
  expect(verifyUnsubscribe(secret, token)).toMatchObject({ tenantId: a, communityId: club, userId: "w-one" });
  await unsubscribeByToken(f.db, secret, `${token.slice(0, -3)}AAA`);
  await unsubscribeByToken(f.db, secret, "garbage");
  expect((await f.admin.query("select email_frequency from community_memberships where user_id = 'w-one'")).rows[0].email_frequency).toBe("important");
  await unsubscribeByToken(f.db, secret, token);
  expect((await f.admin.query("select email_frequency from community_memberships where user_id = 'w-one'")).rows[0].email_frequency).toBe("off");
  await notify("w-one", "warning", "warning");
  expect(await run()).toEqual({ queued: 0, sent: 0, failed: 0 });
});

it("records a failed send with a short code, leaks no address, and does not retry before its back-off", async () => {
  await notify("w-one", "warning", "warning");
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const failing = async () => { throw new Error("provider said no to w-one@example.test"); };
  expect(await runCommunityEmail(f.workerPool, failing, { origin, secret })).toEqual({ queued: 1, sent: 0, failed: 1 });
  const [row] = (await f.admin.query("select status, last_error, attempts, locked_until > now() as waiting from community_email_deliveries")).rows;
  expect(row).toEqual({ status: "failed", last_error: "send_failed", attempts: 1, waiting: true });
  expect(JSON.stringify(spy.mock.calls)).not.toContain("example.test");
  spy.mockRestore();
  expect(await run()).toEqual({ queued: 0, sent: 0, failed: 0 });
  await f.admin.query("update community_email_deliveries set locked_until = now() - interval '1 minute'");
  expect(await run()).toEqual({ queued: 0, sent: 1, failed: 0 });
  expect((await mails()).filter((m) => m.to === "w-one@example.test")).toHaveLength(1);
});

it("lets only an active member set a valid frequency", async () => {
  await expect(saveEmailFrequency(f.db, "w-one", "worker-club", { frequency: "hourly" })).rejects.toThrow();
  await expect(saveEmailFrequency(f.db, "w-one", "worker-club", { frequency: "daily", extra: 1 })).rejects.toThrow();
  await expect(saveEmailFrequency(f.db, "w-outsider", "worker-club", { frequency: "daily" })).rejects.toMatchObject({ status: 404 });
  await expect(saveEmailFrequency(f.db, "w-one", "no-such-club", { frequency: "daily" })).rejects.toMatchObject({ status: 404 });
  expect((await saveEmailFrequency(f.db, "w-one", "worker-club", { frequency: "weekly" })).outcome).toBe("ok");
});

it("lets only one worker run at a time", async () => {
  const wide = new Pool({ connectionString: f.workerURL, max: 3 });
  const [first, second] = [await wide.connect(), await wide.connect()];
  try {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const running = withWorkerLock(first, async () => { await hold; return "first"; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await withWorkerLock(second, async () => "second")).toBeNull();
    release();
    expect(await running).toBe("first");
    expect(await withWorkerLock(second, async () => "second")).toBe("second");
  } finally { first.release(); second.release(); await wide.end(); }
});

it("keeps the live sender disabled", async () => {
  expect(COMMUNITY_EMAIL_LIVE_DELIVERY).toBe(false);
  await expect(sendLiveCommunityEmail({ to: "x@example.test", subject: "s", text: "t", headers: {}, idempotencyKey: "k" })).rejects.toThrow("COMMUNITY_EMAIL_DELIVERY_DISABLED");
});
