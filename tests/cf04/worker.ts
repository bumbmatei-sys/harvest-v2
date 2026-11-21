import assert from "node:assert/strict";
import background from "../../src/worker/background";
import { dispatchScheduled, jobRegistry, parseDispatch, type JobDispatch, type JobName, type JobPort } from "../../src/worker/jobs/dispatch";
import { createWorkerJobPort, type ExecutionBindings } from "../../src/worker/jobs/execute";
import { jobLease } from "../../src/worker/jobs/lease";
import { cloudflareQueue, consumeQueue, memoryQueue, type QueueDelivery, type QueuePort } from "../../src/worker/jobs/queue";
import { socialPublishGateOpen, socialRouteDeps } from "../../src/server/social-publish-gate";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { seedSyntheticInbox } from "../../src/server/social/inbox-fixtures";
import { createReplyHandoff, type TransientReply } from "../../src/server/social/inbox-reply-handoff";

type Bindings = ExecutionBindings & {
  JOB_QUEUE: { send(body: JobDispatch): Promise<void> };
  JOB_DEAD_LETTERS: { send: QueuePort["deadLetter"] };
};

type DeliveryResult = "ack" | number;
function delivery(body: unknown, attempts: number, record: (result: DeliveryResult) => void): QueueDelivery {
  return { body, attempts, ack: () => record("ack"), retry: ({ delaySeconds }) => record(delaySeconds) };
}

const allow = () => true;
const slot = Date.UTC(2026, 10, 21, 2, 7);
const connect = { job: "connect_retention", scheduledTime: slot } as const;
let expiredHolder: ReturnType<typeof jobLease> | undefined;
const nativeDeadLetters: unknown[] = [];

async function checks(env: Bindings) {
  const { port, pending, deadLetters } = memoryQueue();
  const adapter = cloudflareQueue(
    { send: body => port.enqueue(body) },
    { send: body => port.deadLetter(body) },
  );
  const sent: JobDispatch[] = [];
  const fakeJobs: JobPort = { async run(dispatch) { sent.push(dispatch); return "done"; } };
  await dispatchScheduled({ cron: "*/5 * * * *", scheduledTime: slot }, fakeJobs, allow);
  assert.deepEqual(sent.map(dispatch => dispatch.job), ["social_publish", "social_inbox"]);
  await dispatchScheduled({ cron: "unknown", scheduledTime: slot }, fakeJobs, allow);
  assert.equal(sent.length, 2);

  const poison = { ...connect, tenantId: "forged" };
  const production = { HARVEST_ENV: "production", ...Object.fromEntries(
    ["WORKER_HYPERDRIVE", "JOB_QUEUE", "JOB_DEAD_LETTERS"].map(key => [key, undefined])) };
  for (const [job, definition] of Object.entries(jobRegistry)) {
    const dispatch = { job: job as JobName, scheduledTime: slot };
    const untouched = () => { throw new Error("DISABLED_DELIVERY_TOUCHED"); };
    await background.scheduled({ cron: definition.cron, scheduledTime: slot }, production);
    await background.queue({ messages: [delivery(dispatch, 1, untouched)] }, production);
    await assert.rejects(createWorkerJobPort(production, { allowed: allow }).run(dispatch), /LOCAL_JOB_FIXTURE_REQUIRED/);
    await assert.rejects(createWorkerJobPort(env).run(dispatch), /WORKER_JOB_DISABLED/);
  }
  assert.equal(socialPublishGateOpen({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" }), false);
  assert.equal(socialRouteDeps({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" }).enabled, false);
  assert.equal(socialPublishGateOpen({ NODE_ENV: "test", VERCEL_ENV: "production" }), false);
  assert.throws(() => socialRouteDeps({ NODE_ENV: "test" }).provider("zernio"));

  const jobs = createWorkerJobPort(env, { allowed: allow });
  const retention: JobPort = { run: dispatch => jobs.run(dispatch) };
  const direct = await jobs.run(connect);
  assert.equal(direct, "done");
  await adapter.enqueue(connect);
  assert.deepEqual(pending, [connect]);
  const dispositions: DeliveryResult[] = [];
  const record = (result: DeliveryResult) => dispositions.push(result);
  await consumeQueue([delivery(poison, 1, record), delivery(pending[0], 1, record), delivery(connect, 2, record)],
    retention, adapter, allow);
  assert.deepEqual(dispositions, ["ack", "ack", "ack"]);
  assert.equal(await jobs.run(connect), "duplicate");
  assert.deepEqual(deadLetters, [{ reason: "invalid_dispatch" }]);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const jobs: JobPort = { async run() { if (attempt === 1) return "busy"; throw new Error("FIXTURE_FAILURE"); } };
    await consumeQueue([delivery(connect, attempt, record)], jobs, adapter, allow);
  }
  assert.deepEqual(dispositions.slice(3), [15, 30, 60, 120, "ack"]);
  assert.deepEqual(deadLetters[1], { reason: "attempts_exhausted", dispatch: connect });
  await consumeQueue([delivery(poison, 1, record)], fakeJobs, {
    ...adapter, async deadLetter() { throw new Error("FIXTURE_DLQ_DOWN"); },
  }, allow);
  assert.equal(dispositions.at(-1), 15);
}

async function social(env: Bindings, reply: TransientReply) {
  const fake = socialRouteDeps({ NODE_ENV: "test" }).provider("fake");
  if (!(fake instanceof FakeProvider)) throw new Error("FIXTURE_NOT_FAKE");
  seedSyntheticInbox(fake);
  fake.analyticsPosts.set("test-facebook", [{ ref: "fixture-analytics", publishedAt: new Date(), metrics: { likes: 4 } }]);
  const handoff = createReplyHandoff();
  handoff.offer(reply);
  const jobs = createWorkerJobPort(env, { allowed: allow, handoff });
  const scheduledTime = slot + 1;
  const jobsToRun = ["social_publish", "social_inbox", "social_analytics"] as const;
  for (const job of jobsToRun) assert.equal(await jobs.run({ job, scheduledTime }), "done");
  for (const job of jobsToRun) assert.equal(await jobs.run({ job, scheduledTime }), "duplicate");
  for (const method of ["publishPost", "dispatchInboxReply", "readPostAnalytics"]) {
    assert.equal(fake.calls.filter(call => call.method === method).length, 1);
  }
}

const worker = {
  async queue(batch: { queue: string; messages: readonly QueueDelivery[] }, env: Bindings) {
    if (batch.queue === "cf04-dead") {
      for (const message of batch.messages) {
        nativeDeadLetters.push(message.body);
        message.ack();
      }
      return;
    }
    await consumeQueue(batch.messages, createWorkerJobPort(env, { allowed: allow }),
      cloudflareQueue(env.JOB_QUEUE, env.JOB_DEAD_LETTERS), allow);
  },
  async fetch(request: Request, env: Bindings) {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/checks") await checks(env);
      else if (path === "/social") await social(env, await request.json() as TransientReply);
      else if (path === "/retention") {
        const jobs = createWorkerJobPort(env, { allowed: allow });
        for (const job of ["connect_synthetic_purge", "chat_retention", "newsletter_retention",
          "community_application_purge", "community_notification_purge"] as const) {
          assert.equal(await jobs.run({ job, scheduledTime: slot }), "done");
          assert.equal(await jobs.run({ job, scheduledTime: slot }), "duplicate");
        }
      } else if (path === "/lease/start") {
        const contenders = [jobLease(env, { ...connect, scheduledTime: slot + 2 }), jobLease(env, { ...connect, scheduledTime: slot + 2 })];
        const states = await Promise.all(contenders.map(lease => lease.acquire()));
        assert.deepEqual(states.toSorted(), ["acquired", "busy"]);
        expiredHolder = contenders[states.indexOf("acquired")];
        await expiredHolder.renew();
      } else if (path === "/lease/recover") {
        assert.ok(expiredHolder);
        const write = async () => { throw new Error("STALE_CALLBACK_RAN"); };
        await assert.rejects(expiredHolder.transaction(write, true), /WORKER_JOB_LEASE_LOST/);
        const next = jobLease(env, { ...connect, scheduledTime: slot + 2 });
        assert.equal(await next.acquire(), "acquired");
        await assert.rejects(expiredHolder.finish(true), /WORKER_JOB_LEASE_LOST/);
        await next.finish(true);
      } else if (path === "/role") {
        await assert.rejects(jobLease(env, connect).acquire(), /DATABASE_(URL|PRINCIPAL)_INVALID/);
      } else if (path === "/native/enqueue") {
        const queue = cloudflareQueue(env.JOB_QUEUE, env.JOB_DEAD_LETTERS);
        const dispatch = parseDispatch({ ...connect, scheduledTime: slot + 3 })!;
        await queue.enqueue(dispatch);
        await queue.enqueue(dispatch);
      } else if (path === "/native/dead") {
        return Response.json(nativeDeadLetters);
      } else {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { status: 204 });
    } catch (error) {
      // Only expose named assertion locations and known safe codes from the probe.
      const assertion = error instanceof assert.AssertionError ? error.stack?.match(/script-\d+\.mjs:(\d+):(\d+)/)?.slice(1).join(":") : undefined;
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : undefined;
      return new Response(assertion ?? code ?? "PROBE_CHECK_FAILED", { status: 500 });
    }
  },
};

export default worker;
