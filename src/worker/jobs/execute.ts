import { runRetention } from "../../server/connect-retention";
import { runChatPurge } from "../../server/community-chat-retention";
import { syntheticIntakeEnabled } from "../../server/connect-intake-mode";
import { newsletterWorkerEnabled } from "../../server/newsletter-campaigns/worker";
import { socialPublishGateOpen, socialRouteDeps } from "../../server/social-publish-gate";
import { runSocialAnalyticsRefresh } from "../../server/social/analytics-worker";
import { FakeProvider } from "../../server/social/fake-provider";
import { createReplyHandoff, type ReplyHandoff } from "../../server/social/inbox-reply-handoff";
import { runSocialInboxReplies } from "../../server/social/inbox-reply-worker";
import { runSocialPublisher } from "../../server/social/publisher";
import { runtimeConnectionString } from "../../db/request";
import { jobEnabled, type JobName, type JobPort } from "./dispatch";
import { leasedJobPort, type JobBindings } from "./lease";

export type ExecutionBindings = JobBindings & {
  HARVEST_SOCIAL_PUBLISHER?: string;
  HARVEST_CHAT_PURGE_WORKER_ENABLED?: string;
  HARVEST_CONNECT_INTAKE?: string;
  HARVEST_CONNECT_TEST_KEY?: string;
  HARVEST_NEWSLETTER_RETENTION_ENABLED?: string;
  HARVEST_COMMUNITIES?: string;
};

const socialJobs = new Set<JobName>(["social_publish", "social_inbox", "social_analytics"]);

function localTestUrl(env: ExecutionBindings) {
  if (env.HARVEST_ENV !== "local") throw new Error("LOCAL_JOB_FIXTURE_REQUIRED");
  const url = runtimeConnectionString(env.WORKER_HYPERDRIVE?.connectionString, "worker");
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.search || parsed.hash ||
      !/^\/harvest_test(?:_|$)/.test(parsed.pathname)) {
    throw new Error("LOCAL_JOB_FIXTURE_REQUIRED");
  }
  return url;
}

export function createWorkerJobPort(env: ExecutionBindings, options: {
  // Only the standalone local harness injects an allowlist and transient fake inbox work.
  allowed?: (job: JobName) => boolean;
  handoff?: ReplyHandoff;
} = {}): JobPort {
  const mode = {
    NODE_ENV: env.HARVEST_ENV === "local" ? "test" : "production",
    VERCEL_ENV: process.env.VERCEL_ENV,
    HARVEST_COMMUNITIES: env.HARVEST_COMMUNITIES,
    HARVEST_NEWSLETTER_RETENTION_ENABLED: env.HARVEST_NEWSLETTER_RETENTION_ENABLED,
  };
  const jobs = leasedJobPort(env, async ({ job }, lease) => {
    const query = async <R extends Record<string, unknown>>(statement: string, values?: unknown[]) =>
      lease.transaction(connection => connection.query<R>(statement, values));

    switch (job) {
      case "connect_retention": {
        let outcome;
        try {
          outcome = await lease.transaction(connection => runRetention(connection, { maxBatches: 2 }), result => result.failed === 0);
        } catch (error) {
          await query("select public.connect_retention_record_failure($1)", ["sweep_failed"]).catch(() => undefined);
          throw error;
        }
        if (outcome.failed) throw new Error("WORKER_RETENTION_FAILED");
        return;
      }
      case "connect_synthetic_purge":
        return lease.transaction(async connection => {
          await connection.query("select set_config('app.connect_intake_mode','synthetic',true)");
          await connection.query("select public.purge_connect_invitations()");
          await connection.query("select public.purge_connect_intake()");
        }, true);
      case "chat_retention":
        try {
          await lease.transaction(connection => runChatPurge(connection, { maxBatches: 2 }), true);
        } catch (error) {
          await query("select public.community_chat_purge_record_failure($1)", ["sweep_failed"]).catch(() => undefined);
          throw error;
        }
        return;
      case "newsletter_retention":
        await lease.transaction(connection => connection.query("select public.newsletter_purge_deliveries($1)", [250]), true);
        return;
      case "community_application_purge":
        await lease.transaction(connection => connection.query("select public.community_purge_applications($1)", [250]), true);
        return;
      case "community_notification_purge":
        await lease.transaction(connection => connection.query("select public.community_purge_notifications($1)", [250]), true);
        return;
      case "social_publish":
      case "social_inbox":
      case "social_analytics": {
        const deps = socialRouteDeps(mode);
        if (!deps.enabled) throw new Error("WORKER_FAKE_PROVIDER_REQUIRED");
        const fake = deps.provider("fake");
        if (!(fake instanceof FakeProvider)) throw new Error("WORKER_FAKE_PROVIDER_REQUIRED");
        await lease.renew();
        if (job === "social_publish") {
          const result = await runSocialPublisher({
            query: <R extends Record<string, unknown>>(statement: string, values?: unknown[]) =>
              lease.transaction(async connection => {
                const result = await connection.query<R>(statement, values);
                if (statement === "select public.social_publish_claim($1, $2) as claimed") {
                  const claims = result.rows[0]?.claimed;
                  if (!Array.isArray(claims) || claims.some(claim => claim.provider !== "fake" || claim.delivery == null)) {
                    throw new Error("GROUPED_FAKE_PUBLISHER_REQUIRED");
                  }
                }
                return result;
              }),
          }, deps.provider, { batch: 1 });
          if (result.errored || result.stale) throw new Error("WORKER_PUBLISH_INCOMPLETE");
        } else if (job === "social_inbox") {
          const result = await runSocialInboxReplies({ query }, { fake, handoff: options.handoff ?? createReplyHandoff(), batch: 2 });
          if (result.error || result.stale) throw new Error("WORKER_INBOX_INCOMPLETE");
        } else {
          const result = await runSocialAnalyticsRefresh({ query }, fake, 2);
          if (result.stale) throw new Error("WORKER_ANALYTICS_INCOMPLETE");
        }
        return lease.finish(true);
      }
    }
  });

  return { async run(dispatch) {
    const { job } = dispatch;
    if (!(options.allowed ?? jobEnabled)(job)) throw new Error("WORKER_JOB_DISABLED");
    if (mode.NODE_ENV === "production" || process.env.NODE_ENV === "production" || mode.VERCEL_ENV === "production") {
      throw new Error("LOCAL_JOB_FIXTURE_REQUIRED");
    }
    const url = localTestUrl(env);
    if (socialJobs.has(job) && (env.HARVEST_SOCIAL_PUBLISHER !== "test" || !socialPublishGateOpen(mode))) {
      throw new Error("WORKER_FAKE_PROVIDER_REQUIRED");
    }
    if (job === "connect_synthetic_purge" && !syntheticIntakeEnabled({ ...mode, DATABASE_URL: url,
      HARVEST_CONNECT_INTAKE: env.HARVEST_CONNECT_INTAKE, HARVEST_CONNECT_TEST_KEY: env.HARVEST_CONNECT_TEST_KEY })) {
      throw new Error("WORKER_SYNTHETIC_INTAKE_REQUIRED");
    }
    if (job === "chat_retention" && env.HARVEST_CHAT_PURGE_WORKER_ENABLED !== "1") throw new Error("WORKER_JOB_DISABLED");
    if (job === "newsletter_retention" && !newsletterWorkerEnabled(mode, "HARVEST_NEWSLETTER_RETENTION_ENABLED")) {
      throw new Error("WORKER_JOB_DISABLED");
    }
    return jobs.run(dispatch);
  } };
}
