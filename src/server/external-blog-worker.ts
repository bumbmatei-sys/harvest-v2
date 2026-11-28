import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { ExternalArticleInput, ExternalBlogTarget, RemoteBlogArticle } from "../lib/external-blog";
import { externalArticleHandle } from "./external-blog";
import { credentialBinding, openCredential } from "./social/credential-envelope";
import { SocialProviderError } from "./social/port";
import type { SocialDeps } from "./social/registry";
import type { SocialProviderId } from "./social/types";

type ClaimedJob = ExternalBlogTarget & {
  id: string;
  tenantId: string;
  postId: string;
  connectionId: string;
  provider: SocialProviderId;
  credentialEnvelope: unknown;
  lease: string;
  attempt: number;
  exhausted: boolean;
  authorized: boolean;
  operation: "push" | "update" | "check";
  payload: ExternalArticleInput | null;
  remoteId: string | null;
  contentHash: string | null;
};
type WorkerConnection = {
  query<T extends QueryResultRow>(statement: string, values?: unknown[]): Promise<{ rows: T[] }>;
};
type Outcome = {
  status: "failed" | "published" | "scheduled_on_blog" | "draft_on_blog" | "changed_on_blog";
  reason?: "authorization" | "invalid_request" | "unavailable" | "remote_missing" | "outcome_unknown" | "unsupported";
  article?: RemoteBlogArticle;
  hash?: string;
  backoff?: number;
};

function articleHash(article: RemoteBlogArticle) {
  if (article.bodyHtml === null) throw new SocialProviderError("UNAVAILABLE");
  const { title, bodyHtml, excerpt, tags, image } = article;
  return createHash("sha256").update(JSON.stringify([title, bodyHtml, excerpt, [...tags].sort(), image])).digest("hex");
}

async function perform(job: ClaimedJob, deps: SocialDeps): Promise<Outcome> {
  const provider = deps.provider(job.provider);
  const credential = openCredential(job.credentialEnvelope, credentialBinding(job.tenantId, job.connectionId));
  const target: ExternalBlogTarget = { platform: job.platform, accountRef: job.accountRef, blogRef: job.blogRef };
  let article: RemoteBlogArticle | null;
  if (job.operation === "check") {
    article = job.remoteId ? await provider.getBlogArticle(credential, target, job.remoteId)
      : await provider.findBlogArticle(credential, target, externalArticleHandle(job.postId));
    // A missing result after an ambiguous create cannot prove the write did not happen.
    if (!article) return { status: "failed", reason: "outcome_unknown" };
  } else if (job.operation === "update" && job.payload && job.remoteId) {
    if (job.exhausted) return { status: "failed", reason: "outcome_unknown" };
    article = await provider.updateBlogArticle(credential, target, job.remoteId, job.payload);
  } else if (job.operation === "push" && job.payload) {
    article = job.attempt > 1 ? await provider.findBlogArticle(credential, target, externalArticleHandle(job.postId)) : null;
    if (!article) {
      if (job.exhausted) return { status: "failed", reason: "outcome_unknown" };
      article = await provider.createBlogArticle(credential, target, job.payload, job.id);
    }
  } else {
    return { status: "failed", reason: "invalid_request" };
  }
  if (article.bodyHtml === null) article = await provider.getBlogArticle(credential, target, article.id);
  const hash = articleHash(article);
  const changed = job.operation === "check" && job.contentHash !== null && job.contentHash !== hash;
  const scheduled = article.scheduledAt && new Date(article.scheduledAt) > deps.now();
  return { status: changed ? "changed_on_blog" : article.published ? "published" : scheduled ? "scheduled_on_blog" : "draft_on_blog",
    article, hash };
}

function failure(error: unknown, job: ClaimedJob): Outcome {
  const code = error instanceof SocialProviderError ? error.code : "UNAVAILABLE";
  const uncertainCreate = job.operation === "push" && job.attempt > 1;
  if (code === "AUTH") return { status: "failed", reason: uncertainCreate ? "outcome_unknown" : "authorization" };
  if (code === "NOT_FOUND") return { status: "failed", reason: uncertainCreate ? "outcome_unknown" : "remote_missing" };
  if (code === "UNSUPPORTED" || code === "DISABLED") return { status: "failed", reason: uncertainCreate ? "outcome_unknown" : "unsupported" };
  if (code === "INVALID_REQUEST") return { status: "failed", reason: uncertainCreate ? "outcome_unknown" : "invalid_request" };
  return { status: "failed", reason: job.operation === "check" && job.remoteId ? "unavailable" : "outcome_unknown",
    ...(job.attempt < 4 && !job.exhausted ? { backoff: Math.min(300, Math.max(5 * 2 ** (job.attempt - 1),
      error instanceof SocialProviderError ? Math.ceil((error.retryAfterMs ?? 0) / 1000) : 0)) } : {}) };
}

/** A bounded, local fake-only worker entry point. Claim and completion are independent autocommit statements. */
export async function runExternalBlogWorker(connection: WorkerConnection, deps: SocialDeps, limit = 20) {
  if (!deps.enabled) return 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("BLOG_EXTERNAL_WORKER_LIMIT");
  let processed = 0;
  for (; processed < limit; processed++) {
    const { rows: [row] } = await connection.query<{ claim: ClaimedJob | null }>("select public.blog_external_claim() as claim");
    const job = row?.claim;
    if (!job) break;
    let outcome: Outcome = failure(new SocialProviderError(job.authorized ? "DISABLED" : "AUTH"), job);
    if (job.authorized && job.provider === "fake") {
      try { outcome = await perform(job, deps); }
      catch (error) { outcome = failure(error, job); }
    }
    await connection.query("select public.blog_external_finish($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      job.tenantId, job.id, job.lease, outcome.status, outcome.reason ?? null, outcome.article?.id ?? null,
      outcome.article?.url ?? null, outcome.hash ?? null, outcome.backoff ?? null,
    ]);
  }
  return processed;
}
