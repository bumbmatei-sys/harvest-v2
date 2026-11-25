// These are proposed UTC schedules. No trigger or consumer is configured.
export const WORKER_CRON_ENABLED = false;
export const WORKER_QUEUE_ENABLED = false;
export const CONNECT_RETENTION_ENABLED = false;
export const CONNECT_SYNTHETIC_PURGE_ENABLED = false;
export const CHAT_RETENTION_ENABLED = false;
export const COMMUNITY_APPLICATION_PURGE_ENABLED = false;
export const COMMUNITY_NOTIFICATION_PURGE_ENABLED = false;
export const NEWSLETTER_RETENTION_ENABLED = false;
export const DOCS_TRASH_PURGE_ENABLED = false;
export const SOCIAL_PUBLISH_JOB_ENABLED = false;
export const SOCIAL_INBOX_JOB_ENABLED = false;
export const SOCIAL_ANALYTICS_JOB_ENABLED = false;

export const jobRegistry = {
  connect_retention: { cron: "7 2 * * *", role: "harvest_worker", enabled: CONNECT_RETENTION_ENABLED },
  connect_synthetic_purge: { cron: "17 2 * * *", role: "harvest_worker", enabled: CONNECT_SYNTHETIC_PURGE_ENABLED },
  chat_retention: { cron: "27 2 * * *", role: "harvest_worker", enabled: CHAT_RETENTION_ENABLED },
  community_application_purge: { cron: "37 2 * * *", role: "harvest_worker", enabled: COMMUNITY_APPLICATION_PURGE_ENABLED },
  community_notification_purge: { cron: "47 2 * * *", role: "harvest_worker", enabled: COMMUNITY_NOTIFICATION_PURGE_ENABLED },
  newsletter_retention: { cron: "57 2 * * *", role: "harvest_worker", enabled: NEWSLETTER_RETENTION_ENABLED },
  docs_trash_purge: { cron: "7 3 * * *", role: "harvest_worker", enabled: DOCS_TRASH_PURGE_ENABLED },
  social_publish: { cron: "*/5 * * * *", role: "harvest_worker", enabled: SOCIAL_PUBLISH_JOB_ENABLED },
  social_inbox: { cron: "*/5 * * * *", role: "harvest_worker", enabled: SOCIAL_INBOX_JOB_ENABLED },
  social_analytics: { cron: "12 * * * *", role: "harvest_worker", enabled: SOCIAL_ANALYTICS_JOB_ENABLED },
} as const;
export type JobName = keyof typeof jobRegistry;
export type JobDispatch = { job: JobName; scheduledTime: number };
export type JobResult = "done" | "duplicate" | "busy";

export interface JobPort {
  run(dispatch: JobDispatch): Promise<JobResult>;
}

export function parseDispatch(body: unknown): JobDispatch | undefined {
  if (!body || typeof body !== "object" || Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "job") || !("job" in body) || typeof body.job !== "string" || !Object.hasOwn(jobRegistry, body.job) ||
      !Object.hasOwn(body, "scheduledTime") || !("scheduledTime" in body) || typeof body.scheduledTime !== "number" || !Number.isSafeInteger(body.scheduledTime) ||
      body.scheduledTime < 0 || body.scheduledTime > 253_402_300_799_999) return;
  return { job: body.job as JobName, scheduledTime: body.scheduledTime };
}

export async function dispatchScheduled(event: { cron: string; scheduledTime: number }, jobs: JobPort,
  allowed: (job: JobName) => boolean) {
  const results = await Promise.allSettled((Object.keys(jobRegistry) as JobName[])
    .filter(job => allowed(job) && jobRegistry[job].cron === event.cron)
    .map(job => jobs.run({ job, scheduledTime: event.scheduledTime })));
  if (results.some(result => result.status === "rejected" || result.value === "busy")) {
    throw new Error("WORKER_SCHEDULE_INCOMPLETE");
  }
}

export function jobEnabled(job: JobName) {
  return jobRegistry[job].enabled;
}
