import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
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
import { acceptCommunityEmailFeedback, communityEmailFeedback, communityEmailSuppressions, removeSoftCommunityEmailSuppression } from "../../src/server/community-email-feedback";

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
  f = await testDatabase({ migrationOwner: true });
  dir = await mkdtemp(join(tmpdir(), "harvest-community-email-"));
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.invalid`, emailVerified: true })));
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
  expect(sent.map((m) => m.to).sort()).toEqual(["w-applicant@example.invalid", "w-one@example.invalid", "w-two@example.invalid"]);
  const one = sent.find((m) => m.to === "w-one@example.invalid")!, digest = sent.find((m) => m.to === "w-two@example.invalid")!, applicant = sent.find((m) => m.to === "w-applicant@example.invalid")!;
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
  const failing = async () => { throw new Error("provider said no to w-one@example.invalid"); };
  expect(await runCommunityEmail(f.workerPool, failing, { origin, secret })).toEqual({ queued: 1, sent: 0, failed: 1 });
  const [row] = (await f.admin.query("select status, last_error, attempts, locked_until > now() as waiting from community_email_deliveries")).rows;
  expect(row).toEqual({ status: "failed", last_error: "send_failed", attempts: 1, waiting: true });
  expect(JSON.stringify(spy.mock.calls)).not.toContain("example.invalid");
  spy.mockRestore();
  expect(await run()).toEqual({ queued: 0, sent: 0, failed: 0 });
  await f.admin.query("update community_email_deliveries set locked_until = now() - interval '1 minute'");
  expect(await run()).toEqual({ queued: 0, sent: 1, failed: 0 });
  expect((await mails()).filter((m) => m.to === "w-one@example.invalid")).toHaveLength(1);
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
  await expect(sendLiveCommunityEmail({ deliveryId: "synthetic", to: "x@example.invalid", subject: "s", text: "t", headers: {}, idempotencyKey: "k" })).rejects.toThrow("COMMUNITY_EMAIL_DELIVERY_DISABLED");
});

it("verifies feedback, deduplicates events, and suppresses the exact send-time address only in its ministry", async () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const topicArn = "arn:aws:sns:us-east-1:123456789012:community-test";
  const certificate = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-a1.pem";
  const trusted = { topicArn, certificates: new Map([[certificate, keys.publicKey.export({ type: "spki", format: "pem" }).toString()]]) };
  const env = { WORKER_DATABASE_URL: f.workerURL };
  const now = new Date(), timestamp = now.toISOString();
  const endpoint = origin + "/api/communities/email-feedback";
  function signedRequest(deliveryId: string, outcome: "Permanent" | "Transient" | "Complaint", eventId = randomUUID(), tamper = false) {
    const eventType = outcome === "Complaint" ? "Complaint" : "Bounce";
    const fields = {
      Message: JSON.stringify({ eventType, mail: { messageId: "synthetic-reference", timestamp, tags: { harvest_delivery_id: [deliveryId] } },
        bounce: { bounceType: outcome, timestamp }, complaint: { timestamp }, privateEvidence: "do-not-store@example.invalid" }),
      MessageId: eventId, Timestamp: timestamp, TopicArn: topicArn, Type: "Notification",
    };
    const signature = sign("RSA-SHA256", Buffer.from(Object.entries(fields).flat().join("\n") + "\n"), keys.privateKey).toString("base64");
    return new Request(endpoint, { method: "POST", body: JSON.stringify({ ...fields, SignatureVersion: "2", SigningCertURL: certificate,
      Signature: tamper ? Buffer.alloc(256).toString("base64") : signature }) });
  }
  const send = async (user: string) => {
    await notify(user, "warning", "warning");
    const sent: (CommunityMail & { deliveryId: string })[] = [];
    await runCommunityEmail(f.workerPool, async (mail) => { sent.push({ ...mail, deliveryId: mail.deliveryId ?? mail.idempotencyKey }); }, { origin, secret });
    return sent;
  };
  const accept = (request: Request) => acceptCommunityEmailFeedback(request, trusted, undefined, env, now);
  const [first] = await send("w-one"), feedbackId = randomUUID();
  expect((await communityEmailFeedback(signedRequest(first.deliveryId, "Transient"), env)).status).toBe(404);
  expect((await accept(signedRequest(first.deliveryId, "Permanent", randomUUID(), true))).status).toBe(202);
  expect((await f.admin.query("select count(*)::int as n from community_email_feedback")).rows[0].n).toBe(0);
  expect((await accept(signedRequest(first.deliveryId, "Transient", feedbackId))).status).toBe(202);
  await accept(signedRequest(first.deliveryId, "Transient", feedbackId));
  await accept(signedRequest(first.deliveryId, "Transient"));
  expect((await f.admin.query("select * from community_email_feedback")).rows).toEqual([
    { event_id: feedbackId, delivery_id: first.deliveryId, outcome: "soft_bounce" },
  ]);
  const [second] = await send("w-one");
  await accept(signedRequest(second.deliveryId, "Transient"));
  const [third] = await send("w-one");
  await accept(signedRequest(third.deliveryId, "Transient"));
  const soft = await communityEmailSuppressions(f.db, "w-owner", a, 1);
  expect(soft.counts).toEqual({ soft: 1, hard: 0, complaints: 0 });
  expect(soft.items[0]).toMatchObject({ maskedAddress: "***@example.invalid", reason: "soft_bounce" });
  expect(await send("w-one")).toEqual([]);
  expect((await f.admin.query("select last_error from community_email_deliveries where status='skipped'")).rows).toContainEqual({ last_error: "address_suppressed" });
  expect(await removeSoftCommunityEmailSuppression(f.db, "w-owner", a, soft.items[0].id)).toEqual({ removed: true });
  const [fourth] = await send("w-one");
  await accept(signedRequest(fourth.deliveryId, "Permanent"));
  expect((await communityEmailSuppressions(f.db, "w-owner", a, 1)).counts.hard).toBe(1);
  await accept(signedRequest(fourth.deliveryId, "Complaint"));
  const complaint = await communityEmailSuppressions(f.db, "w-owner", a, 1);
  expect(complaint.counts).toEqual({ soft: 0, hard: 0, complaints: 1 });
  expect(await removeSoftCommunityEmailSuppression(f.db, "w-owner", a, complaint.items[0].id)).toEqual({ removed: false });
  await expect(communityEmailSuppressions(f.db, "w-one", a, 1)).rejects.toMatchObject({ status: 403 });
  await expect(f.pool.query("select public.community_email_apply_feedback($1,$2,'complaint')", [randomUUID(), fourth.deliveryId])).rejects.toHaveProperty("code", "42501");
  await expect(f.workerPool.query("select * from community_email_feedback")).rejects.toHaveProperty("code", "42501");
  await expect(f.workerPool.query("select * from community_email_feedback_grants")).rejects.toHaveProperty("code", "42501");
  await expect(f.pool.query("select * from community_email_feedback_grants")).rejects.toHaveProperty("code", "42501");
  expect((await f.admin.query("select count(*)::int as n from community_email_feedback_grants")).rows[0].n).toBe(0);
  const other = (await createWorkspace(f.db, "w-outsider", "Other ministry", "church")).tenantId;
  expect((await communityEmailSuppressions(f.db, "w-outsider", other, 1)).items).toEqual([]);
  const otherClub = (await createCommunity(f.db, "w-outsider", other, { name: "Other club", slug: "other-club" })).id;
  await f.admin.query("update communities set status='published' where id=$1", [otherClub]);
  await f.admin.query("insert into community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, detail) values ($1,$2,'w-one','application','application',gen_random_uuid()::text,'{\"status\":\"approved\"}')", [other, otherClub]);
  const sent: CommunityMail[] = [];
  await runCommunityEmail(f.workerPool, async (mail) => { sent.push(mail); }, { origin, secret });
  expect(sent.map((mail) => mail.to)).toEqual(["w-one@example.invalid"]);
});
