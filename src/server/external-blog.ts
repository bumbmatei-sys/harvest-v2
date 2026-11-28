import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { auditLogs, blogExternalAssets, blogExternalDeliveries, blogExternalDestinations, blogExternalJobs, blogPosts, socialConnections } from "../db/schema";
import { derivedExcerpt, publishProblems } from "../lib/blog";
import { externalBlogCapabilities, externalBlogPlatforms, isExternalBlogPlatform, type ExternalArticleInput, type ExternalBlog } from "../lib/external-blog";
import { message } from "../i18n/messages";
import { requireBlogEnabled } from "./blog";
import { exportBlogHtml, type ExternalBlogWarning } from "./external-blog-html";
import { AccessError, type Permission } from "./permissions";
import { credentialBinding, openCredential, sealCredential } from "./social/credential-envelope";
import { SocialProviderError } from "./social/port";
import { assertEnabled, defaultSocialDeps, type SocialDeps } from "./social/registry";
import { withTenant } from "./tenancy";
import { appOriginIfConfigured } from "../lib/site-address";

const uuid = z.uuid();
const mode = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("draft") }).strict(),
  z.object({ mode: z.literal("same_time") }).strict(),
  z.object({ mode: z.literal("own_time"), at: z.iso.datetime({ offset: true }) }).strict(),
]);
const inputSchema = z.object({
  version: z.number().int().positive(),
  destinationId: uuid,
  operation: z.enum(["push", "update", "check"]),
  timing: mode.optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
}).strict();
type Article = typeof blogPosts.$inferSelect;
type Delivery = typeof blogExternalDeliveries.$inferSelect;
type Destination = typeof blogExternalDestinations.$inferSelect;
const unavailable = () => new AccessError(404, message("Errors.thisViewIsNotAvailable"));
const problem = (reason: string) => new AccessError(400, message("Errors.checkTheSuppliedDetails"), { reason });
const stale = (reason = "stale") => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason });
const match = (tenant: string, id: string) => and(eq(blogExternalDestinations.tenantId, tenant), eq(blogExternalDestinations.id, id));
const canonical = (article: Article) => article.harvestPage ? "unsupported" as const : "not_requested" as const;
const siteOrigin = () => appOriginIfConfigured();
async function withBlogAccess<T>(db: Database, user: string, workspace: string, permission: Permission,
  run: (tx: Transaction, tenant: string) => Promise<T>): Promise<T> {
  try { return await withTenant(db, user, uuid.parse(workspace), permission, run); }
  catch (error) {
    if (error instanceof AccessError && error.status === 403) throw unavailable();
    throw error;
  }
}

export const externalArticleHandle = (postId: string) => `harvest-${postId}`;

async function loadArticle(tx: Transaction, tenant: string, postId: string, lock: boolean) {
  const query = tx.select().from(blogPosts).where(and(eq(blogPosts.tenantId, tenant), eq(blogPosts.id, postId)));
  const [article] = await (lock ? query.for("update") : query);
  if (!article) throw unavailable();
  return article;
}

function authorize(deps: SocialDeps) {
  requireBlogEnabled();
  assertEnabled(deps);
}

const connectInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), platform: z.enum(externalBlogPlatforms),
    shop: z.string().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com$/).optional() }).strict(),
  z.object({ action: z.literal("finish"), attempt: z.string().max(2500) }).strict(),
]);
const connectAttempt = z.object({
  id: uuid, platform: z.enum(externalBlogPlatforms), profileRef: z.string().min(1).max(200), expiresAt: z.number(),
}).strict();

export async function connectExternalBlog(db: Database, user: string, workspace: string, raw: unknown,
  deps = defaultSocialDeps(), origin = siteOrigin()) {
  authorize(deps);
  const connection = deps.blogConnect;
  if (!connection) throw unavailable();
  // The base social connection policy only accepts actual owners and admins.
  const tenant = await withBlogAccess(db, user, workspace, "social:connect", async (tx, tenantId) => {
    const { rows } = await tx.execute(sql`select 1 from public.workspace_members
      where (tenant_id,user_id) = (${tenantId}::uuid,${user}) and role_id in ('owner','admin')`);
    if (!rows.length) throw unavailable();
    return tenantId;
  });
  const input = connectInput.parse(raw);
  const provider = deps.provider(connection.providerId), binding = `external-blog-sign-in:${tenant}:${user}`;
  try {
    if (input.action === "start") {
      if ((input.platform === "shopify") !== Boolean(input.shop)) throw problem("shop_domain");
      const base = origin ? URL.parse(origin) : null;
      if (!base || base.protocol !== "https:" || base.username || base.password) throw unavailable();
      const id = randomUUID();
      const started = await provider.startBlogConnect(connection.credential, {
        platform: input.platform, attemptId: id, shop: input.shop,
        callback: new URL(`/workspaces/${tenant}/blog`, base.origin).href,
      });
      const expiresAt = deps.now().getTime() + 30 * 60_000;
      const attempt = sealCredential({ secret: JSON.stringify({ id, platform: input.platform, profileRef: started.profileRef, expiresAt }) }, binding);
      return { status: "pending", url: started.url, attempt: Buffer.from(JSON.stringify(attempt)).toString("base64url"), expiresAt: new Date(expiresAt) };
    }
    let attempt;
    try { attempt = connectAttempt.parse(JSON.parse(openCredential(JSON.parse(Buffer.from(input.attempt, "base64url").toString()), binding).secret)); }
    catch { throw unavailable(); }
    if (attempt.expiresAt <= deps.now().getTime()) throw unavailable();
    const account = await provider.findBlogConnection(connection.credential, attempt.profileRef, attempt.platform);
    if (!account) return { status: "pending" };
    if (account.platform !== attempt.platform) throw unavailable();
    const envelope = sealCredential(connection.credential, credentialBinding(tenant, attempt.id));
    return await withBlogAccess(db, user, tenant, "social:connect", async (tx) => {
      const [stored] = await tx.insert(socialConnections).values({
        tenantId: tenant, id: attempt.id, createdBy: user, provider: connection.providerId, platform: attempt.platform,
        credentialEnvelope: { ...envelope }, externalAccountRef: account.accountRef, displayName: account.displayName,
      }).onConflictDoNothing().returning({ id: socialConnections.id });
      if (!stored) throw stale("connection_already_linked");
      await tx.insert(auditLogs).values({ tenantId: tenant, actorId: user, action: "blog.external.connect", targetId: stored.id,
        metadata: { outcome: "authorized" } });
      return { status: "authorized", connectionId: stored.id };
    });
  } catch (error) {
    if (error instanceof SocialProviderError) throw unavailable();
    throw error;
  }
}

export async function listExternalBlogs(db: Database, user: string, workspace: string, deps = defaultSocialDeps()) {
  authorize(deps);
  return withBlogAccess(db, user, workspace, "blog:manage", async (tx, tenant) => {
    const connections = await tx.select({
      id: socialConnections.id, platform: socialConnections.platform, label: socialConnections.displayName,
      health: socialConnections.health, status: socialConnections.status, checkedAt: socialConnections.healthCheckedAt,
    }).from(socialConnections).where(and(eq(socialConnections.tenantId, tenant), inArray(socialConnections.platform, [...externalBlogPlatforms])));
    const destinations = await tx.select().from(blogExternalDestinations).where(eq(blogExternalDestinations.tenantId, tenant));
    const accounts = new Map(connections.map(({ status, ...connection }) => [connection.id, {
      ...connection, authorization: status === "active" ? "authorized" as const : "unavailable" as const,
    }]));
    // Website managers can see discovered account metadata without reading the social credential row.
    for (const destination of destinations) {
      if (!accounts.has(destination.connectionId)) accounts.set(destination.connectionId, {
        id: destination.connectionId, label: null, platform: destination.platform, health: destination.health,
        authorization: destination.authorization, checkedAt: destination.checkedAt,
      });
    }
    return {
      accounts: [...accounts.values()],
      destinations: destinations.map(({ id, connectionId, title, platform, health, authorization, checkedAt }) => ({
        id, connectionId, title, platform, health, authorization, checkedAt, capabilities: externalBlogCapabilities[platform],
      })),
    };
  });
}

export async function refreshExternalBlogs(db: Database, user: string, workspace: string, connectionId: string, deps = defaultSocialDeps()) {
  authorize(deps);
  const id = uuid.parse(connectionId);
  const load = (tx: Transaction, tenant: string) => tx.select().from(socialConnections)
    .where(and(eq(socialConnections.tenantId, tenant), eq(socialConnections.id, id), eq(socialConnections.status, "active")));
  const [connection] = await withBlogAccess(db, user, workspace, "social:connect", load);
  if (!connection || !isExternalBlogPlatform(connection.platform)) throw unavailable();
  const provider = deps.provider(connection.provider);
  const credential = openCredential(connection.credentialEnvelope, credentialBinding(connection.tenantId, id));
  let blogs: ExternalBlog[] = [], health: Destination["health"] = "unknown", allowed = false;
  try {
    health = (await provider.getAccountHealth(credential, connection.externalAccountRef)).health;
    if (health !== "failing") {
      blogs = await provider.listBlogs(credential, connection.externalAccountRef);
      allowed = true;
    }
  } catch (error) {
    if (!(error instanceof SocialProviderError)) throw error;
    health = error.code === "AUTH" ? "failing" : "degraded";
  }
  try {
    return await withBlogAccess(db, user, connection.tenantId, "social:connect", async (tx, tenant) => {
      const [current] = await load(tx, tenant).for("share");
      if (!current || current.version !== connection.version) throw unavailable();
      // The app role can only read the catalog. The definer checks owner/admin membership and the connection version again.
      const list = allowed ? JSON.stringify(blogs.map((blog) => ({ id: blog.id, title: blog.title }))) : null;
      const { rows: [written] } = await tx.execute<{ count: number | null }>(sql`select public.blog_external_refresh(
        ${tenant}::uuid, ${id}::uuid, ${connection.version}::integer, ${health}, ${list}::jsonb) as count`);
      if (written?.count === null || written?.count === undefined) throw unavailable();
      await tx.insert(auditLogs).values({ tenantId: tenant, actorId: user, action: "blog.external.refresh", targetId: id,
        metadata: { outcome: allowed ? "authorized" : "unavailable" } });
      return { authorization: allowed ? "authorized" : "unavailable", health, count: blogs.length };
    });
  } catch (error) {
    const refusal = error as { code?: string; cause?: { code?: string } } | null;
    if ((refusal?.cause?.code ?? refusal?.code) === "42501") throw unavailable();
    throw error;
  }
}

function render(article: Article, destination: Destination, imageUrl: (id: string) => string | null, delivery?: Delivery) {
  const output = exportBlogHtml(article.body, destination.platform, imageUrl);
  const warnings: ExternalBlogWarning[] = output.warnings;
  const featured = article.coverFileId ? imageUrl(article.coverFileId) : null;
  const capabilities = externalBlogCapabilities[destination.platform];
  if (article.coverFileId && !featured) warnings.push("image_unavailable");
  if (!article.coverFileId && delivery?.remoteId) warnings.push("featured_image_preserved");
  if (!capabilities.seo && (article.seoTitle || article.seoDescription)) warnings.push("seo_unsupported");
  // Webflow collections can omit the optional summary field. Sending it in that case fails the write.
  if (destination.platform === "webflow" && article.excerpt) warnings.push("excerpt_optional");
  const seo = capabilities.seo && (article.seoTitle || article.seoDescription)
    ? { title: article.seoTitle ?? undefined, description: article.seoDescription ?? undefined } : undefined;
  const excerpt = destination.platform !== "webflow" ? derivedExcerpt(article.excerpt, article.body) : "";
  const payload: ExternalArticleInput = { title: article.title, bodyHtml: output.bodyHtml,
    ...(excerpt ? { excerpt } : {}), ...(seo ? { seo } : {}), ...(featured ? { image: { url: featured } } : {}) };
  return { payload, warnings: [...new Set(warnings)] };
}

const deliveryView = (delivery: Delivery, article: Article) => {
  const expected = article.publishAt ?? article.publishedAt;
  return {
    id: delivery.id, destinationId: delivery.destinationId, mode: delivery.mode, requestedAt: delivery.requestedAt,
    status: delivery.status, reason: delivery.reason, remote: delivery.remoteId !== null, remoteUrl: delivery.remoteUrl, pushedVersion: delivery.pushedVersion,
    createdAt: delivery.createdAt, updatedAt: delivery.updatedAt, pushedAt: delivery.pushedAt, checkedAt: delivery.checkedAt,
    scheduleUpdateAvailable: delivery.mode === "same_time" && (delivery.requestedAt?.getTime() ?? null) !== (expected?.getTime() ?? null),
  };
};

export type ExternalBlogOptions = Awaited<ReturnType<typeof externalBlogOptions>>;
export type ExternalDeliveryView = ReturnType<typeof deliveryView>;
export type ExternalPlannerDelivery = Awaited<ReturnType<typeof externalBlogPlanner>>[number];

export async function externalBlogOptions(db: Database, user: string, workspace: string, postId: string, deps = defaultSocialDeps()) {
  authorize(deps);
  return withBlogAccess(db, user, workspace, "blog:manage", async (tx, tenant) => {
    const article = await loadArticle(tx, tenant, uuid.parse(postId), false);
    const destinations = await tx.select().from(blogExternalDestinations).where(eq(blogExternalDestinations.tenantId, tenant));
    const deliveries = await tx.select().from(blogExternalDeliveries).where(and(eq(blogExternalDeliveries.tenantId, tenant), eq(blogExternalDeliveries.postId, article.id)));
    const byDestination = new Map(deliveries.map((delivery) => [delivery.destinationId, delivery]));
    return { harvestPage: article.harvestPage, version: article.version, destinations: destinations.map((destination) => {
      const delivery = byDestination.get(destination.id);
      const { warnings } = render(article, destination, (id) => `https://images.example.invalid/${id}`, delivery);
      return { id: destination.id, connectionId: destination.connectionId, title: destination.title, platform: destination.platform,
        authorization: destination.authorization, health: destination.health, capabilities: externalBlogCapabilities[destination.platform],
        canonical: canonical(article), warnings, delivery: delivery ? deliveryView(delivery, article) : null };
    }) };
  });
}

async function imageGrants(tx: Transaction, article: Article, origin: string | undefined) {
  const ids = [...new Set([...article.imageIds, ...(article.coverFileId ? [article.coverFileId] : [])])];
  const urls = new Map<string, string>();
  if (!ids.length) return urls;
  const base = origin ? URL.parse(origin) : null;
  if (!base || base.protocol !== "https:" || base.username || base.password) throw problem("image_origin_unavailable");
  await tx.execute(sql`insert into public.blog_external_assets (tenant_id, file_id)
    select ${article.tenantId}::uuid, image.file_id from unnest(array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]) as image(file_id)
    on conflict (tenant_id, file_id) do nothing`);
  const grants = await tx.select().from(blogExternalAssets)
    .where(and(eq(blogExternalAssets.tenantId, article.tenantId), inArray(blogExternalAssets.fileId, ids)));
  for (const grant of grants) urls.set(grant.fileId, new URL(`/api/integrations/blog/image/${grant.id}`, base.origin).href);
  return urls;
}

function requestedTime(timing: z.infer<typeof mode>, article: Article, now: Date) {
  if (timing.mode === "draft") return null;
  const at = timing.mode === "same_time" ? article.publishAt ?? article.publishedAt : new Date(timing.at);
  if (!at || (timing.mode === "own_time" && at <= now) || at.getTime() > now.getTime() + 366 * 86_400_000) throw problem("schedule");
  return at;
}

export async function queueExternalBlog(db: Database, user: string, workspace: string, postId: string, raw: unknown,
  deps = defaultSocialDeps(), origin = siteOrigin()) {
  authorize(deps);
  const input = inputSchema.parse(raw);
  return withBlogAccess(db, user, workspace, "blog:manage", async (tx, tenant) => {
    const article = await loadArticle(tx, tenant, uuid.parse(postId), true);
    const [destination] = await tx.select().from(blogExternalDestinations).where(match(tenant, input.destinationId));
    if (!destination || destination.authorization !== "authorized" || destination.health === "failing") throw unavailable();
    if (input.version !== article.version) throw stale();
    const [current] = await tx.select().from(blogExternalDeliveries)
      .where(and(eq(blogExternalDeliveries.tenantId, tenant), eq(blogExternalDeliveries.postId, article.id), eq(blogExternalDeliveries.destinationId, destination.id))).for("update");
    if (current) {
      const pending = await tx.select({ id: blogExternalJobs.id }).from(blogExternalJobs)
        .where(and(eq(blogExternalJobs.tenantId, tenant), eq(blogExternalJobs.deliveryId, current.id), isNull(blogExternalJobs.finishedAt)));
      if (pending.length) throw stale("already_queued");
    }
    const operation = input.operation;
    if (operation === "check" && (!current || (!current.remoteId && current.reason !== "outcome_unknown"))) throw unavailable();
    if (operation === "update" && !current?.remoteId) throw unavailable();
    if (operation === "push" && (current?.remoteId || current?.reason === "outcome_unknown")) throw stale("status_check_required");
    let delivery: Delivery | undefined = current, payload: ExternalArticleInput | null = null;
    let warnings: ExternalBlogWarning[] = [];
    if (operation !== "check") {
      if (!input.timing || publishProblems(article).length) throw problem("article_not_ready");
      const now = deps.now(), at = requestedTime(input.timing, article, now);
      if (at && at > now && !externalBlogCapabilities[destination.platform].nativeSchedule) throw problem("schedule_unsupported");
      const images = await imageGrants(tx, article, origin);
      const rendered = render(article, destination, (id) => images.get(id) ?? null, current);
      payload = { ...rendered.payload, ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(operation === "push" ? { handle: externalArticleHandle(article.id) } : {}),
        ...(at && at > now ? { publishDate: at.toISOString() } : { isPublished: at !== null }) };
      warnings = rendered.warnings;
      if (!payload.bodyHtml) throw problem("article_not_ready");
      const values = { mode: input.timing.mode, requestedAt: at, status: "queued" as const, reason: null, updatedAt: now };
      if (current) {
        [delivery] = await tx.update(blogExternalDeliveries).set(values)
          .where(and(eq(blogExternalDeliveries.tenantId, tenant), eq(blogExternalDeliveries.id, current.id))).returning();
      } else {
        const { rows: [created] } = await tx.execute<{ id: string }>(sql`insert into public.blog_external_deliveries
          (tenant_id, post_id, destination_id, mode, requested_at)
          values (${tenant}::uuid, ${article.id}::uuid, ${destination.id}::uuid, ${values.mode}, ${at?.toISOString() ?? null}::timestamptz) returning id`);
        [delivery] = await tx.select().from(blogExternalDeliveries)
          .where(and(eq(blogExternalDeliveries.tenantId, tenant), eq(blogExternalDeliveries.id, created.id)));
      }
    }
    if (!delivery) throw unavailable();
    const { rows: [job] } = await tx.execute<{ id: string }>(sql`insert into public.blog_external_jobs
      (tenant_id, delivery_id, operation, post_version, payload)
      values (${tenant}::uuid, ${delivery.id}::uuid, ${operation}, ${article.version}, ${payload ? JSON.stringify(payload) : null}::jsonb) returning id`);
    await tx.insert(auditLogs).values({ tenantId: tenant, actorId: user, action: "blog.external.queue", targetId: delivery.id,
      metadata: { jobId: job.id, postId: article.id, version: String(article.version), outcome: operation } });
    return { jobId: job.id, delivery: deliveryView(delivery, article), canonical: canonical(article), warnings };
  });
}

export async function externalBlogPlanner(db: Database, user: string, workspace: string, range: { from: string; to: string }) {
  return withBlogAccess(db, user, workspace, "blog:manage", async (tx, tenant) => {
    const { rows } = await tx.execute<{
      id: string; postId: string; destinationId: string; title: string; destinationTitle: string; platform: Destination["platform"];
      mode: Delivery["mode"]; status: Delivery["status"]; at: string; remoteUrl: string | null;
    }>(sql`
      select d.id, d.post_id as "postId", b.id as "destinationId", p.title, b.title as "destinationTitle", b.platform,
        d.mode, d.status, coalesce(d.requested_at,d.created_at) as at, d.remote_url as "remoteUrl"
      from public.blog_external_deliveries d
      join public.blog_posts p on (p.tenant_id,p.id) = (d.tenant_id,d.post_id)
      join public.blog_external_destinations b on (b.tenant_id,b.id) = (d.tenant_id,d.destination_id)
      where d.tenant_id = ${tenant}::uuid and coalesce(d.requested_at,d.created_at) >= ${range.from}::timestamptz
        and coalesce(d.requested_at,d.created_at) < ${range.to}::timestamptz
      order by at,d.id limit 500`);
    return rows;
  });
}
