import { analyticsCapabilities, isoAnalyticsDay, projectMetrics, type AnalyticsStatus } from "../../lib/social/analytics";
import type { SocialPlatform } from "../../lib/social/platforms";
import { credentialBinding, openCredential } from "./credential-envelope";
import { referenceInput } from "./inbox-access";
import { SocialProviderError, type SocialProvider } from "./port";

export const SOCIAL_ANALYTICS_REFRESH_ENABLED = false;
type Pool = { query<R extends Record<string, unknown>>(query: string, values: unknown[]): Promise<{ rows: R[] }> };
type Claim = {
  tenant_id: string; connection_id: string; external_account_ref: string; credential_envelope: unknown;
  lease: string; platform: SocialPlatform; version: number; current_page: number; failures: number;
};
const emptyPosts = { posts: [], nextPage: null, pending: false };
const emptyAccounts = { days: [], partial: false };
const utcDay = (instant: number) => new Date(instant).toISOString().slice(0,10);
const dayMs = 86_400_000;
const providerPostRangeDays = 366;

export async function runSocialAnalyticsRefresh(pool: Pool, fake: SocialProvider & { id: "fake" }, limit = 4) {
  if (fake.id !== "fake") throw new Error("ANALYTICS_WORKER_UNAVAILABLE");
  const { rows: [{ jobs }] } = await pool.query<{ jobs: Claim[] }>("select public.social_analytics_claim($1) as jobs",[limit]);
  const results = { claimed: jobs.length, completed: 0, stale: 0, pruned: 0 };

  for (let index=0; index<jobs.length; index+=2) await Promise.all(jobs.slice(index,index+2).map(async claim => {
    const caps = analyticsCapabilities(claim.platform);
    let state: AnalyticsStatus = "unavailable", delay = 86400, page = claim.current_page;
    let posts: unknown[] = [], accounts: unknown[] = [], slots: unknown[] = [];
    if (caps.post.length || caps.account.length || caps.bestTimes) {
      try {
        const credential = openCredential(claim.credential_envelope,credentialBinding(claim.tenant_id,claim.connection_id));
        const query = { accountRef: claim.external_account_ref, platform: claim.platform, signal: AbortSignal.timeout(8_000) };
        const now = Date.now(), to = utcDay(now), from = utcDay(now - 31*dayMs);
        const size = ["youtube","linkedin"].includes(claim.platform) ? 8 : 30;
        const [postRead,accountRead,timeRead] = await Promise.allSettled([
          caps.post.length ? fake.readPostAnalytics(credential,{ ...query, from:utcDay(now-(providerPostRangeDays-1)*dayMs), to, page, limit:size, order:"date" }) : emptyPosts,
          caps.account.length ? fake.readAccountAnalytics(credential,{ ...query, from, to }) : emptyAccounts,
          caps.bestTimes ? fake.readBestPostingTimes(credential,query) : [],
        ]);
        const reads = [postRead,accountRead,timeRead];
        const errorList = reads.filter(read => read.status === "rejected").map(read => read.reason as unknown);
        const retryAfter = Math.max(postRead.status==="fulfilled" && "retryAfterMs" in postRead.value ? postRead.value.retryAfterMs ?? 0 : 0,...errorList.map(error=>error instanceof SocialProviderError ? error.retryAfterMs ?? 0 : 0));
        const expired = errorList.some(error=>error instanceof SocialProviderError && (error.code==="AUTH" || error.code==="EXPIRED"));
        if (expired) {
          state = "expired";
        } else {
          if (postRead.status === "fulfilled") {
            const unique = new Map<string,object>();
            for (const row of postRead.value.posts.slice(0,size)) {
              if (!referenceInput.safeParse(row.ref).success || !(row.publishedAt instanceof Date) || !Number.isFinite(row.publishedAt.getTime())) continue;
              unique.set(row.ref,{ ref:row.ref,native_ref:referenceInput.safeParse(row.nativeRef).success ? row.nativeRef : null,
                published_at:row.publishedAt.toISOString(),metrics:projectMetrics(row.metrics,caps.post) });
            }
            posts = [...unique.values()];
          }
          if (accountRead.status === "fulfilled") {
            const unique = new Map<string,object>();
            for (const row of accountRead.value.days.slice(0,32)) {
              if (!isoAnalyticsDay.safeParse(row.day).success || row.day<from || row.day>to) continue;
              unique.set(row.day,{ day:row.day,metrics:projectMetrics(row.metrics,caps.account) });
            }
            accounts = [...unique.values()];
          }
          if (timeRead.status === "fulfilled") {
            const unique = new Map<string,object>();
            for (const {day,hour,engagement,samples} of timeRead.value.slice(0,168)) {
              if (!Number.isInteger(day) || day<0 || day>6 || !Number.isInteger(hour) || hour<0 || hour>23 ||
                  !Number.isFinite(engagement) || engagement<0 || engagement>Number.MAX_SAFE_INTEGER ||
                  !Number.isInteger(samples) || samples<1 || samples>2147483647) continue;
              unique.set(`${day}:${hour}`,{ weekday:day,hour,engagement,samples });
            }
            slots = [...unique.values()];
          }
          const more = postRead.status === "fulfilled" && postRead.value.nextPage === page+1 && page<10000;
          const required = Number(caps.post.length>0)+Number(caps.account.length>0)+Number(caps.bestTimes);
          const pending = (postRead.status === "fulfilled" && postRead.value.pending) ||
            (accountRead.status === "fulfilled" && accountRead.value.partial);
          if (errorList.length === required) {
            state = errorList.every(error=>error instanceof SocialProviderError && error.code==="UNSUPPORTED") ? "unavailable" : "delayed";
          } else {
            state = (errorList.length || more || pending) ? "partial" : "ready";
          }
          if (more) page++;
          else if (postRead.status === "fulfilled" && !postRead.value.pending) page=1;
          if (state==="delayed" || state==="partial") {
            const backoff = Math.min(3600,60*2**Math.min(6,claim.failures));
            delay = Math.min(86400,Math.max(more ? 10 : backoff,Math.ceil(retryAfter/1000)));
          } else if (state==="ready") delay=3600;
        }
      } catch {
        state = "delayed";
        delay = 600;
      }
    }

    const { rows: [{ saved }] } = await pool.query<{ saved:boolean }>(
      "select public.social_analytics_complete($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as saved",
      [claim.tenant_id,claim.connection_id,claim.lease,claim.version,state,page,delay,JSON.stringify(posts),JSON.stringify(accounts),JSON.stringify(slots)]);
    if (saved) results.completed++;
    else results.stale++;
  }));

  const { rows: [{ pruned }] } = await pool.query<{ pruned:number }>("select public.social_analytics_prune($1) as pruned",[500]);
  results.pruned = pruned;
  return results;
}
