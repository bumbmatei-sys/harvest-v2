import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { accountMetrics, analyticsCapabilities, analyticsStatuses, analyticsTimezone, isoAnalyticsDay, postMetrics, projectMetrics,
  type AccountMetric, type AnalyticsStatus, type Metrics, type PostMetric } from "../../lib/social/analytics";
import { socialPlatforms, type SocialPlatform } from "../../lib/social/platforms";
import { digest, withInbox } from "./inbox-access";
import { publishInvalid, recordId, unavailable } from "./publish-access";
import { defaultSocialDeps, type SocialDeps } from "./registry";

const metrics = [...postMetrics,"engagement","followers","followerChange","profileViews","published"] as const;
type Metric = typeof metrics[number];
const interactionMetrics = ["likes","comments","shares","saves"] as const;
const rankMetrics = [...postMetrics,"engagement"] as const;
const rangeInput = z.object({ from:isoAnalyticsDay, to:isoAnalyticsDay, timezone:analyticsTimezone.default("UTC"),
  connectionId:z.string().optional(), platform:z.enum(socialPlatforms).optional(), metric:z.enum(metrics).default("engagement"),
  rankBy:z.enum(rankMetrics).default("engagement") });
type Range = z.infer<typeof rangeInput>;
type Reading = { value: number | null; availability: "available" | "partial" | "unavailable" };
type Account = { id:string; platform:SocialPlatform; displayName:string; connectionState:string; status:AnalyticsStatus; lastRefreshedAt:string|null; retryAfter:number|null };
type PostPoint = { connection_id:string; provider_ref:string; planner_post_id:string|null; published_at:string; captured_at:string;
  captured_day:string; published_day:string; weekday:number; hour:number; metrics:Metrics<PostMetric>; before:boolean };
type AccountPoint = { connection_id:string; day:string; metrics:Metrics<AccountMetric> };
type Publication = { connection_id:string; id:string; provider_post_ref:string; published_at:string; published_day:string };
type Slot = { connection_id:string; weekday:number; hour:number; engagement:number; samples:number; day:string };
const limit = 12_000;
const dayMs = 86_400_000;
const dateMs = (day:string) => Date.parse(`${day}T00:00:00Z`);
const key = (account:string,ref:string) => JSON.stringify([account,ref]);
const empty = (): Metrics<Metric> => ({});
const sumMetric = (target:Metrics<Metric>, metric:Metric, value:number) => { target[metric] = (target[metric] ?? 0)+value; };
const toDate = (value: string | Date) => new Date(value).toISOString();
const reading = (value:number|undefined, partial:boolean): Reading =>
  value===undefined ? {value:null,availability:"unavailable"} : {value,availability:partial ? "partial" : "available"};

function readRange(search: URLSearchParams) {
  const parsed = rangeInput.safeParse(Object.fromEntries(search));
  if (!parsed.success) throw publishInvalid("ANALYTICS_INVALID_RANGE");
  const input = parsed.data;
  const days = (dateMs(input.to)-dateMs(input.from))/dayMs+1;
  if (days<1 || days>366 || input.from<"1970-01-01" || input.to>"2100-12-31") throw publishInvalid("ANALYTICS_INVALID_RANGE");
  return { input, days:Array.from({length:days},(_,i)=>new Date(dateMs(input.from)+i*dayMs).toISOString().slice(0,10)) };
}

type AccountRow = { id:string; platform:SocialPlatform; display_name:string; status:string; health:string; health_code:string|null;
  state:AnalyticsStatus|null; refreshed_at:string|null; due_after:number|null };
function accountStatus(row:AccountRow): AnalyticsStatus {
  if (row.status!=="active" || /expired|token_revoked|reauth/.test(row.health_code ?? "")) return "expired";
  if (row.health==="failing" || row.health==="degraded") return "delayed";
  const cap = analyticsCapabilities(row.platform);
  if (!cap.post.length && !cap.account.length && !cap.bestTimes) return "unavailable";
  return analyticsStatuses.find(status=>status===row.state) ?? "pending";
}

function supports(account:Account,metric:Metric) {
  const cap = analyticsCapabilities(account.platform);
  if (metric==="published") return true;
  if (metric==="engagement") return interactionMetrics.some(item=>cap.post.includes(item));
  if (metric==="followerChange") return cap.account.includes("followers");
  if (metric==="followers" || metric==="profileViews") return cap.account.includes(metric);
  return cap.post.includes(metric);
}

type PostTotal = { ref:string; plannerPostId:string|null; publishedAt:string; publicationDay:string; weekday:number; hour:number;
  connectionId:string; metrics:Metrics<Metric>; points:Map<string,Metrics<Metric>> };

function collectPosts(rows:PostPoint[], from:string) {
  const posts = new Map<string,PostTotal>(), previous = new Map<string,Metrics<PostMetric>>();
  for (const row of rows) {
    const postKey = key(row.connection_id,row.provider_ref);
    const prior = previous.get(postKey) ?? {};
    if (!row.before) {
      const post = posts.get(postKey) ?? { ref: row.provider_ref, plannerPostId: row.planner_post_id, publishedAt:toDate(row.published_at),
        publicationDay:row.published_day, weekday:row.weekday, hour:row.hour, connectionId:row.connection_id, metrics:empty(), points:new Map() };
      post.plannerPostId ??= row.planner_post_id;
      const day = post.points.get(row.captured_day) ?? empty();
      for (const metric of postMetrics) {
        const value = row.metrics[metric];
        if (value===undefined) continue;
        // A newly published post starts at zero. Older posts need an observed baseline.
        const baseline = prior[metric] ?? (row.published_day>=from ? 0 : undefined);
        if (baseline===undefined) continue;
        sumMetric(post.metrics,metric,value-baseline);
        sumMetric(day,metric,value-baseline);
        if (interactionMetrics.some(field=>field===metric)) {
          sumMetric(post.metrics,"engagement",value-baseline);
          sumMetric(day,"engagement",value-baseline);
        }
      }
      post.points.set(row.captured_day,day);
      posts.set(postKey,post);
    }
    previous.set(postKey,{...prior,...row.metrics});
  }
  return [...posts.values()];
}

function groupByConnection<Row extends {connection_id:string}>(points:Row[]) {
  const grouped = new Map<string,Row[]>();
  for (const point of points) {
    const group = grouped.get(point.connection_id);
    if (group) group.push(point);
    else grouped.set(point.connection_id,[point]);
  }
  return grouped;
}

function buildReport(rows: { posts:PostPoint[]; account:AccountPoint[]; publications:Publication[]; slots:Slot[] },
  accounts:Account[], range:Range, days:string[], clipped:boolean, includeDetail:boolean) {
  const posts = collectPosts(rows.posts,range.from);
  const accountById = new Map(accounts.map(account=>[account.id,account]));
  const scores = new Map<string,Metrics<Metric>>();
  const timelines = new Map<string,Map<string,Metrics<Metric>>>();
  const publications = new Set<string>();
  const deliveryRefs = new Set<string>();
  const postHeatmap = new Map<string,{day:number;hour:number;total:number;samples:number}>();
  const at = (id:string,day:string) => {
    let dates = timelines.get(id);
    if (dates===undefined) { dates=new Map(); timelines.set(id,dates); }
    const values = dates.get(day) ?? empty();
    dates.set(day,values);
    return values;
  };
  for (const account of accounts) scores.set(account.id,empty());
  const publication = (id:string,ref:string,day:string) => {
    const identity = key(id,ref);
    if (publications.has(identity) || day<range.from || day>range.to) return;
    publications.add(identity);
    sumMetric(scores.get(id)!,"published",1);
    sumMetric(at(id,day),"published",1);
  };
  for (const row of rows.publications) {
    deliveryRefs.add(key(row.connection_id,row.provider_post_ref));
    publication(row.connection_id,row.id,row.published_day);
  }
  for (const post of posts) {
    const id = post.connectionId, values = scores.get(id)!;
    if (post.plannerPostId || !deliveryRefs.has(key(id,post.ref))) publication(id,post.plannerPostId ?? post.ref,post.publicationDay);
    for (const [day,point] of post.points) {
      for (const metric of rankMetrics) if (point[metric]!==undefined) sumMetric(at(id,day),metric,point[metric]);
    }
    for (const metric of rankMetrics) if (post.metrics[metric]!==undefined) sumMetric(values,metric,post.metrics[metric]);
    const engagement = post.metrics.engagement;
    if (engagement!==undefined && post.publicationDay>=range.from && post.publicationDay<=range.to) {
      const slotKey = `${post.weekday}:${post.hour}`;
      const slot = postHeatmap.get(slotKey) ?? {day:post.weekday,hour:post.hour,total:0,samples:0};
      slot.total+=engagement;
      slot.samples++;
      postHeatmap.set(slotKey,slot);
    }
  }

  const accountPoints = groupByConnection(rows.account);
  for (const account of accounts) {
    const values = scores.get(account.id)!;
    let baseline: number | undefined, latest: number | undefined;
    for (const point of accountPoints.get(account.id) ?? []) {
      const {followers,profileViews} = point.metrics;
      if (point.day<range.from) { if (followers!==undefined) baseline=followers; continue; }
      if (followers!==undefined) {
        at(account.id,point.day).followers=followers;
        if ((latest ?? baseline)!==undefined) at(account.id,point.day).followerChange=followers-(latest ?? baseline)!;
        latest=followers;
      }
      if (profileViews!==undefined) {
        at(account.id,point.day).profileViews=profileViews;
        sumMetric(values,"profileViews",profileViews);
      }
    }
    if (latest!==undefined) {
      values.followers=latest;
      if (baseline!==undefined) values.followerChange=latest-baseline;
    }
  }
  const combined = (subset:Account[], metric:Metric, day?:string) => {
    let total:number|undefined;
    let partial=clipped;
    for (const account of subset) {
      if (!supports(account,metric)) { partial=true; continue; }
      const source = day ? timelines.get(account.id)?.get(day) : scores.get(account.id);
      const value=source?.[metric];
      if (value!==undefined || metric==="published") total=(total ?? 0)+(value ?? 0);
      if ((metric!=="published" && value===undefined) || account.status!=="ready") partial=true;
    }
    return reading(total,partial);
  };
  const summary = (subset:Account[]) => {
    const reach = combined(subset,"reach"), impressions = combined(subset,"impressions"), views = combined(subset,"views");
    const exposureMetric = reach.value!==null ? "reach" : impressions.value!==null ? "impressions" : "views";
    return { published:combined(subset,"published"), reach, impressions, views, engagement:combined(subset,"engagement"),
      followerChange:combined(subset,"followerChange"), exposure:{metric:exposureMetric,reading:exposureMetric==="reach" ? reach : exposureMetric==="impressions" ? impressions : views} };
  };
  const platforms=[...new Set(accounts.map(account=>account.platform))];
  const series = (subset:Account[]) => days.map(day=>({day,...combined(subset,range.metric,day)}));
  const breakdown = platforms.map(platform=>{
    const subset=accounts.filter(account=>account.platform===platform);
    return { platform,summary:summary(subset),series:series(subset) };
  });
  const byAccount = accounts.map(account=>({
    id:account.id, platform:account.platform, displayName:account.displayName, connectionState:account.connectionState,
    status:account.status, lastRefreshedAt:account.lastRefreshedAt, capabilities:analyticsCapabilities(account.platform),
    summary:summary([account]), series:series([account]),
  }));
  const availablePosts = posts.filter(post=>post.metrics[range.rankBy]!==undefined).sort((a,b)=>
    b.metrics[range.rankBy]!-a.metrics[range.rankBy]! || a.connectionId.localeCompare(b.connectionId) || a.ref.localeCompare(b.ref));
  const postView = (post:PostTotal) => ({ ref:post.ref,plannerPostId:post.plannerPostId,publishedAt:post.publishedAt,
    connectionId:post.connectionId,platform:accountById.get(post.connectionId)?.platform,
    metrics:Object.fromEntries(rankMetrics.map(metric=>[metric,reading(post.metrics[metric],
      clipped || accountById.get(post.connectionId)?.status!=="ready")])) });
  const recommendation = new Map<string,{day:number;hour:number;total:number;samples:number}>();
  const latestSlotDay = new Map(rows.slots.map(row=>[row.connection_id,row.day]));
  for (const row of rows.slots) {
    if (row.day!==latestSlotDay.get(row.connection_id)) continue;
    const slotKey = `${row.weekday}:${row.hour}`;
    const slot = recommendation.get(slotKey) ?? {day:row.weekday,hour:row.hour,total:0,samples:0};
    slot.total+=row.engagement*row.samples;
    slot.samples+=row.samples;
    recommendation.set(slotKey,slot);
  }
  const heatmap = (source: typeof recommendation) => Array.from({length:168},(_,index)=>{
    const day=Math.floor(index/24), hour=index%24, point=source.get(`${day}:${hour}`);
    return {day,hour,averageEngagement:point ? point.total/point.samples : null,samples:point?.samples ?? 0};
  });
  return { summary:summary(accounts), platforms:breakdown, accounts:byAccount, series:{metric:range.metric,points:series(accounts)},
    topPosts:availablePosts.slice(0,10).map(postView), bottomPosts:availablePosts.slice(-10).reverse().map(postView),
    bestTimes:{ timezone:range.timezone,heatmap:heatmap(postHeatmap),provider:{timezone:"UTC",heatmap:heatmap(recommendation)} },
    detailPosts:includeDetail ? posts.map(post=>({ ...postView(post), series:days.map(day=>({ day, ...reading(
      post.points.get(day)?.[range.metric],clipped || accountById.get(post.connectionId)?.status!=="ready") })) })) : [] };
}

async function readAnalytics(db:Database,user:string,workspace:string,search:URLSearchParams,
  deps:SocialDeps=defaultSocialDeps(), requestedPostId?:string) {
  return withInbox(db,user,workspace,deps,async (tx,tenant) => {
    const {input:range,days}=readRange(search);
    const postId=requestedPostId===undefined ? undefined : recordId(requestedPostId);
    const load = async <T extends Record<string,unknown>>(query:SQL) => (await tx.execute<T>(query)).rows;
    const start = sql`(${range.from}::date::timestamp AT TIME ZONE ${range.timezone})`;
    const end = sql`((${range.to}::date+1)::timestamp AT TIME ZONE ${range.timezone})`;
    const filterAccount = range.connectionId===undefined ? undefined : recordId(range.connectionId);
    const accountRows = await load<AccountRow>(sql`
      SELECT c.id,c.platform,c.display_name,c.status,c.health,c.health_code,r.refreshed_at,
        CASE WHEN r.state='ready' AND r.due_at < now()-interval '1 hour' THEN 'delayed' ELSE r.state END AS state,
        CASE WHEN r.state in ('partial','delayed') THEN ceil(extract(epoch from (r.due_at-now())))::int END AS due_after
      FROM social_connections c LEFT JOIN social_analytics_refresh r ON (r.tenant_id,r.connection_id)=(c.tenant_id,c.id)
      WHERE c.tenant_id=${tenant} AND (${filterAccount ?? null}::uuid IS NULL OR c.id=${filterAccount ?? null})
        AND (${range.platform ?? null}::text IS NULL OR c.platform=${range.platform ?? null})
        AND (${postId ?? null}::uuid IS NULL OR EXISTS(SELECT 1 FROM social_posts p
          WHERE (p.tenant_id,p.connection_id)=(c.tenant_id,c.id) AND p.id=${postId ?? null} AND p.status='published'))
      ORDER BY c.platform,c.id LIMIT 101`);
    if (filterAccount && !accountRows.length) throw unavailable();
    let accounts:Account[] = accountRows.slice(0,100).map(row=>({id:row.id,platform:row.platform,displayName:row.display_name,connectionState:row.status,status:accountStatus(row),
      lastRefreshedAt:row.refreshed_at ? toDate(row.refreshed_at) : null,retryAfter:row.due_after && row.due_after>0 ? row.due_after : null}));
    const membership = () => accounts.length ? sql`IN (${sql.join(accounts.map(row=>sql`${row.id}::uuid`),sql`,`)})` : sql`IS NULL`;
    const detail = postId ? (await load<Publication>(sql`
      SELECT connection_id,id,provider_post_ref,published_at,to_char(published_at at time zone ${range.timezone},'YYYY-MM-DD') AS published_day
      FROM social_posts WHERE tenant_id=${tenant} AND status='published' AND id=${postId} AND connection_id ${membership()}`))[0] : undefined;
    if (postId && !detail) throw unavailable();
    if (detail) accounts=accounts.filter(account=>account.id===detail.connection_id);
    const inAccounts = membership();
    const publications = detail ? [detail] : await load<Publication>(sql`
      SELECT connection_id,id,provider_post_ref,published_at,to_char(published_at at time zone ${range.timezone},'YYYY-MM-DD') AS published_day
      FROM social_posts WHERE tenant_id=${tenant} AND status='published' AND connection_id ${inAccounts}
        AND published_at>=${start} AND published_at<${end}
      ORDER BY published_at,id LIMIT ${limit+1}`);
    const posts = await load<PostPoint>(sql`
      WITH period AS (
        SELECT s.* FROM social_analytics_posts s WHERE tenant_id=${tenant} AND connection_id ${inAccounts}
          AND day BETWEEN ${range.from}::date-1 AND ${range.to}::date+1 AND captured_at>=${start} AND captured_at<${end}
          AND (${detail?.id ?? null}::uuid IS NULL OR planner_post_id=${detail?.id ?? null} OR provider_ref=${detail?.provider_post_ref ?? null})
        ORDER BY captured_at,connection_id,provider_ref LIMIT ${limit+1}
      ), wanted AS (SELECT DISTINCT connection_id,provider_ref FROM period),
      rows AS (
        SELECT *,false AS before FROM period
        UNION ALL
        SELECT baseline.*,true AS before FROM wanted
        CROSS JOIN LATERAL (
          SELECT s.* FROM social_analytics_posts s WHERE (tenant_id,connection_id,provider_ref)=(${tenant},wanted.connection_id,wanted.provider_ref)
            AND s.day <= ${range.from}::date+1 AND s.captured_at<${start} ORDER BY s.day DESC LIMIT 1
        ) baseline
      )
      SELECT connection_id,provider_ref,planner_post_id,published_at,captured_at,metrics,before,
        to_char(captured_at at time zone ${range.timezone},'YYYY-MM-DD') AS captured_day,
        to_char(published_at at time zone ${range.timezone},'YYYY-MM-DD') AS published_day,
        extract(isodow from published_at at time zone ${range.timezone})::int-1 AS weekday,
        extract(hour from published_at at time zone ${range.timezone})::int AS hour
      FROM rows ORDER BY connection_id,provider_ref,captured_at`);
    const account = await load<AccountPoint>(sql`
      SELECT connection_id,to_char(day,'YYYY-MM-DD') AS day,metrics
      FROM social_analytics_accounts WHERE tenant_id=${tenant} AND connection_id ${inAccounts}
        AND day BETWEEN ${range.from}::date-31 AND ${range.to}::date
      ORDER BY connection_id,day LIMIT ${limit+1}`);
    const slots = await load<Slot>(sql`
      SELECT t.connection_id,t.weekday,t.hour,t.engagement,t.samples,to_char(t.day,'YYYY-MM-DD') AS day
      FROM social_analytics_times t JOIN (SELECT connection_id,max(day) AS day FROM social_analytics_times
        WHERE tenant_id=${tenant} AND connection_id ${inAccounts} AND day<=${range.to}::date GROUP BY connection_id
      ) recent ON (t.connection_id,t.day)=(recent.connection_id,recent.day) WHERE t.tenant_id=${tenant}
      ORDER BY t.connection_id,t.weekday,t.hour LIMIT ${limit+1}`);
    const clipped = accountRows.length>100 || [publications,account,slots].some(list=>list.length>limit) || posts.filter(row=>!row.before).length>limit;
    const {detailPosts,...report}=buildReport({ posts:posts.map(row=>({...row,metrics:projectMetrics(row.metrics,postMetrics)})),
      account:account.slice(0,limit).map(row=>({...row,metrics:projectMetrics(row.metrics,accountMetrics)})),
      publications:publications.slice(0,limit),slots:slots.slice(0,limit)},accounts,range,days,clipped,!!detail);
    const partial = clipped || accounts.some(account=>["pending","partial","expired","delayed"].includes(account.status));
    const retryAfter = Math.max(0,...accounts.map(account=>account.retryAfter ?? 0)) || undefined;
    const base = { range,partial,truncated:clipped,retryAfter,lastRefreshedAt:accounts.map(account=>account.lastRefreshedAt).filter(Boolean).sort().at(-1) ?? null };
    const detailTotal = detail ? detailPosts.find(post=>post.plannerPostId===detail.id || post.ref===detail.provider_post_ref) : undefined;
    const body = detail ? { ...base,account:report.accounts[0],
      post: { ...(detailTotal ?? { ref:detail.provider_post_ref,publishedAt:toDate(detail.published_at),
        metrics:Object.fromEntries(rankMetrics.map(metric=>[metric,reading(undefined,false)])),
        series:days.map(day=>({day,...reading(undefined,false)})) }),
      plannerPostId:detail.id,connectionId:detail.connection_id,platform:accounts[0].platform } } : { ...base,...report };
    return { ...body,etag:`"${digest({...body,retryAfter:undefined})}"` };
  },"social:analytics");
}

export async function readSocialAnalytics(db:Database,user:string,workspace:string,search:URLSearchParams,
  deps:SocialDeps=defaultSocialDeps()) {
  const report=await readAnalytics(db,user,workspace,search,deps);
  if (!("summary" in report) || !report.summary) throw new Error("ANALYTICS_REPORT_UNAVAILABLE");
  return report;
}

export async function readSocialPostAnalytics(db:Database,user:string,workspace:string,postId:string,search:URLSearchParams,
  deps:SocialDeps=defaultSocialDeps()) {
  const report=await readAnalytics(db,user,workspace,search,deps,postId);
  if (!("post" in report) || !report.post) throw unavailable();
  return report;
}
