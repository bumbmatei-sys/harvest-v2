import { dispatchScheduled, jobEnabled, WORKER_CRON_ENABLED, WORKER_QUEUE_ENABLED, type JobDispatch } from "./jobs/dispatch";
import { createWorkerJobPort, type ExecutionBindings } from "./jobs/execute";
import { cloudflareQueue, consumeQueue, type QueueDelivery, type QueuePort } from "./jobs/queue";

type BackgroundBindings = ExecutionBindings & {
  JOB_QUEUE?: { send(body: JobDispatch): Promise<void> };
  JOB_DEAD_LETTERS?: { send: QueuePort["deadLetter"] };
};

// A separate entry point keeps worker credentials out of the web Worker.
// The manual probe imports this entry without configuring any production triggers.
const background = {
  async scheduled(event: { cron: string; scheduledTime: number }, env: BackgroundBindings) {
    if (!WORKER_CRON_ENABLED) return;
    if (env.HARVEST_ENV !== "local") return;
    if (!env.JOB_QUEUE || !env.JOB_DEAD_LETTERS) throw new Error("WORKER_QUEUE_BINDINGS_REQUIRED");
    const queue = cloudflareQueue(env.JOB_QUEUE, env.JOB_DEAD_LETTERS);
    await dispatchScheduled(event, { async run(dispatch) {
      await queue.enqueue(dispatch);
      return "done";
    } }, jobEnabled);
  },
  async queue(batch: { messages: readonly QueueDelivery[] }, env: BackgroundBindings) {
    if (!WORKER_QUEUE_ENABLED) return;
    if (env.HARVEST_ENV !== "local") return;
    if (!env.JOB_QUEUE || !env.JOB_DEAD_LETTERS) throw new Error("WORKER_QUEUE_BINDINGS_REQUIRED");
    const queue = cloudflareQueue(env.JOB_QUEUE, env.JOB_DEAD_LETTERS);
    await consumeQueue(batch.messages, createWorkerJobPort(env), queue, jobEnabled);
  },
};

export default background;
