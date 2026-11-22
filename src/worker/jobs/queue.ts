import { parseDispatch, type JobDispatch, type JobName, type JobPort } from "./dispatch";

type DeadLetter = { reason: "invalid_dispatch" } | { reason: "attempts_exhausted"; dispatch: JobDispatch };

export interface QueuePort {
  enqueue(dispatch: JobDispatch): Promise<void>;
  deadLetter(record: DeadLetter): Promise<void>;
}

type QueueBinding<T> = { send(body: T): Promise<void> };
export function cloudflareQueue(queue: QueueBinding<JobDispatch>, deadLetters: QueueBinding<DeadLetter>): QueuePort {
  return { enqueue: dispatch => queue.send(dispatch), deadLetter: record => deadLetters.send(record) };
}

export function memoryQueue() {
  const pending: JobDispatch[] = [];
  const deadLetters: DeadLetter[] = [];
  const port: QueuePort = {
    enqueue: async dispatch => { pending.push({ ...dispatch }); },
    deadLetter: async record => { deadLetters.push(structuredClone(record)); },
  };
  return { port, pending, deadLetters };
}

export interface QueueDelivery {
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options: { delaySeconds: number }): void;
}

export const QUEUE_MAX_ATTEMPTS = 5;
export async function consumeQueue(messages: readonly QueueDelivery[], jobs: JobPort, queue: QueuePort,
  allowed: (job: JobName) => boolean) {
  for (const message of messages) {
    const dispatch = parseDispatch(message.body);
    const retry = () => message.retry({ delaySeconds: 15 * 2 ** Math.min(4, Math.max(0, message.attempts - 1)) });
    if (dispatch) {
      if (!allowed(dispatch.job)) {
        message.ack();
        continue;
      }
      try {
        const result = await jobs.run(dispatch);
        if (result !== "busy") {
          message.ack();
          continue;
        }
      } catch {
        // Fixed dispositions only. The job exception can contain private data.
      }
      if (message.attempts < QUEUE_MAX_ATTEMPTS) {
        retry();
        continue;
      }
    }
    try {
      await queue.deadLetter(dispatch ? { reason: "attempts_exhausted", dispatch } : { reason: "invalid_dispatch" });
      message.ack();
    } catch {
      // The platform retry cap is the fallback if the DLQ itself is unavailable.
      retry();
    }
  }
}
