import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { CANARY, depsFor, event, noNetwork, seedPeople, signedRequest, useTestKeys } from "./social-layer-fixture";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { socialPlatforms } from "../../src/lib/social/platforms";
import { linkConnection, listConnections } from "../../src/server/social/service";
import { changeDraft, previewDraft, readDraft, saveDraft } from "../../src/server/social/drafts";
import { changePostingSchedule, createPostingSchedule, listPostingSchedules } from "../../src/server/social/posting-schedules";
import { listPlanner, listScheduleQueue, listUnscheduledDrafts } from "../../src/server/social/planner";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { confirmSocialUpload, createSocialUpload, signSocialUpload, type SocialUploadStorage } from "../../src/server/files/social-upload";
import { receiveSocialWebhook } from "../../src/server/social/webhook";
import { drainJobs } from "../../src/server/jobs/service";
import { withTenant } from "../../src/server/tenancy";
import { sql } from "drizzle-orm";
import { fileKey } from "../../src/lib/files";

const fake = new FakeProvider({ validSecret: CANARY, accounts: socialPlatforms.map(platform => ({ platform, accountRef: platform, displayName: platform })) });
let f: Awaited<ReturnType<typeof testDatabase>>;
let p: Awaited<ReturnType<typeof seedPeople>>;
const deps = depsFor(fake);
const ids = new Map<string, string>();
let fetchSpy: ReturnType<typeof noNetwork>;
const account = (platform: string) => ids.get(platform)!;
const document = (connectionIds = [account("facebook")]) => ({ type: "post", content: "Sunday gathering", connectionIds });
const save = (data = document()) => saveDraft(f.db, p.owner, p.tenant, data, deps);
const change = (id: string, data: Record<string, unknown>, user = p.owner) => changeDraft(f.db, user, p.tenant, id, data, deps);
const read = (id: string) => readDraft(f.db, p.owner, p.tenant, id, deps);
async function submitNow(id: string, version: number) {
  const reviewed = await change(id, { action: "review", version });
  return change(id, { action: "publishNow", version: reviewed.draft.version, reviewToken: reviewed.review!.token, timezone: "UTC" });
}
const scheduleDefault = { name: "Ministry schedule", timezone: "America/New_York", slots: [{ day: 1, time: "10:00" }] };
const run = (opts?: Parameters<typeof runSocialPublisher>[2]) => runSocialPublisher(f.workerPool, () => fake, opts);
async function readyImage(tenant = p.tenant, owner = p.owner) {
  const id = randomUUID();
  await f.admin.query(`insert into files (id,tenant_id,owner_id,key,name,mime,size,checksum,status,social_upload,media_metadata)
    values ($1,$2,$3,$4,'photo.jpg','image/jpeg',1024,$5,'ready',true,'{"width":1080,"height":1080}')`, [id, tenant, owner, fileKey(tenant, id), "a".repeat(64)]);
  return id;
}

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true }); p = await seedPeople(f, "sp");
  useTestKeys(); fetchSpy = noNetwork();
  for (const platform of socialPlatforms) {
    const linked = await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", accountRef: platform, credential: CANARY }, deps);
    ids.set(platform, linked.connection.id);
  }
}, 60_000);
afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
afterAll(async () => { fetchSpy?.mockRestore(); useKeyProvider(null); await f?.close(); });

it("stores every audited platform under a restricted owner and exposes unavailable capabilities", async () => {
  const { connections } = await listConnections(f.db, p.admin, p.tenant, deps);
  expect(connections.map(item => item.platform).sort()).toEqual([...socialPlatforms].sort());
  expect(connections.find(item => item.platform === "snapchat")?.capabilities.postTypes.story).toBe("unavailable");
  expect(connections.find(item => item.platform === "facebook")?.capabilities.postTypes.story).toBe("supported");
  await expect(withTenant(f.db, p.owner, p.tenant, "social:connect", tx => tx.execute(sql`
    insert into social_connections (tenant_id, provider, platform, external_account_ref, credential_envelope, created_by)
    select tenant_id, provider, 'invented', 'invalid-platform-fixture', credential_envelope, created_by
    from social_connections where id = ${account("facebook")}`))).rejects.toMatchObject({ cause: { code: "23514" } });
  for (const table of ["social_drafts", "social_schedules"]) {
    expect((await f.admin.query("select relforcerowsecurity from pg_class where relname=$1", [table])).rows[0].relforcerowsecurity).toBe(true);
    await expect(f.workerPool.query(`select * from ${table}`)).rejects.toMatchObject({ code: "42501" });
  }
  await expect(f.pool.query("select public.social_publish_media($1,$2,$3)", [p.tenant, randomUUID(), randomUUID()])).rejects.toMatchObject({ code: "42501" });
  expect((await f.workerPool.query("select public.social_publish_media($1,$2,$3) as value", [p.tenant, randomUUID(), randomUUID()])).rows[0].value).toBeNull();
});

it("uses neutral missing responses and isolates drafts, schedules and media across ministries in SQL", async () => {
  await save();
  await expect(readDraft(f.db, p.member, p.tenant, randomUUID(), deps)).rejects.toMatchObject({ status: 404 });
  await expect(saveDraft(f.db, p.outsider, p.other, document(), deps)).rejects.toMatchObject({ status: 404 });
  const otherImage = await readyImage(p.other, p.outsider);
  const data = { ...document(), media: [{ fileId: otherImage }] };
  await expect(saveDraft(f.db, p.owner, p.tenant, data, deps)).rejects.toMatchObject({ status: 404 });
  expect((await previewDraft(f.db, p.owner, p.tenant, data, deps)).destinations[0].media[0]).toMatchObject({ accepted: false, errors: ["MEDIA_NOT_AVAILABLE"] });
  const client = await f.pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)", [p.tenant, p.member]);
    expect((await client.query("select id from social_drafts")).rows).toEqual([]);
    expect((await client.query("select id from social_schedules")).rows).toEqual([]);
  } finally { await client.query("rollback"); client.release(); }
});

it("enforces per-platform variants and stale versions and invalidates a reviewed version on edit", async () => {
  const { draft } = await saveDraft(f.db, p.owner, p.tenant, {
    ...document([account("facebook"), account("threads")]), variants: { threads: { mode: "custom", content: "Short variant" } },
  }, deps);
  const reviewed = await change(draft.id, { action: "review", version: draft.version });
  expect(reviewed.review?.destinations.map(item => item.content).sort()).toEqual(["Short variant", "Sunday gathering"]);
  await expect(change(draft.id, { action: "publishNow", version: reviewed.draft.version, reviewToken: reviewed.review?.token, timezone: "UTC" }, p.admin))
    .rejects.toMatchObject({ details: { code: "REVIEW_REQUIRED" } });
  await expect(change(draft.id, { action: "save", version: draft.version, document: document() })).rejects.toMatchObject({ details: { code: "STALE_VERSION" } });
  const edited = await change(draft.id, { action: "save", version: reviewed.draft.version, document: document() });
  await expect(change(draft.id, { action: "publishNow", version: edited.draft.version, reviewToken: reviewed.review?.token, timezone: "UTC" }))
    .rejects.toMatchObject({ details: { code: "REVIEW_REQUIRED" } });
  const cloned = await change(draft.id, { action: "duplicate", version: edited.draft.version });
  expect(cloned.draft.id).not.toBe(draft.id);
  expect(cloned.draft.document.content).toBe("Sunday gathering");
  const audit = await f.admin.query("select metadata from audit_logs where target_id=$1", [draft.id]);
  expect(JSON.stringify(audit.rows)).not.toContain("Sunday gathering");
});

it("allocates distinct next slots, keeps a per-platform queue and supports versioned move and archive", async () => {
  const { schedule } = await createPostingSchedule(f.db, p.owner, p.tenant, scheduleDefault, deps);
  const short = await createPostingSchedule(f.db, p.owner, p.tenant, { ...scheduleDefault, name: "Threads", platform: "threads" }, deps);
  expect((await listPostingSchedules(f.db, p.owner, p.tenant, deps)).defaultScheduleId).toBe(schedule.id);
  const first = await save(document([account("facebook"), account("threads")]));
  const second = await save();
  const results = await Promise.all([first, second].map(result => change(result.draft.id, { action: "schedule", version: 1, target: { kind: "next" } })));
  const a = results[0].draft.destinations.find(item => item.connectionId === account("facebook"))!;
  const b = results[1].draft.destinations[0];
  expect(a.scheduledFor?.getTime()).not.toBe(b.scheduledFor?.getTime());
  expect(a.displayTimezone).toBe("America/New_York");
  expect(results[0].draft.destinations.find(item => item.connectionId === account("threads"))?.scheduleId).toBe(short.schedule.id);
  expect((await listScheduleQueue(f.db, p.owner, p.tenant, schedule.id, {}, deps)).queue).toHaveLength(2);
  await expect(changePostingSchedule(f.db, p.owner, p.tenant, schedule.id, { version: 1 }, true, deps)).rejects.toMatchObject({ details: { code: "SCHEDULE_HAS_QUEUE" } });
  const at = new Date(Date.now() + 3_600_000).toISOString();
  await change(first.draft.id, { action: "move", version: 2, target: { kind: "time", scheduledFor: at, timezone: "Europe/Bucharest" } });
  await change(second.draft.id, { action: "cancel", version: 2 });
  await changePostingSchedule(f.db, p.owner, p.tenant, schedule.id, { ...scheduleDefault, version: 1, name: "Edited" }, false, deps);
  await expect(changePostingSchedule(f.db, p.owner, p.tenant, schedule.id, { version: 1 }, true, deps)).rejects.toMatchObject({ details: { code: "STALE_VERSION" } });
  await changePostingSchedule(f.db, p.owner, p.tenant, schedule.id, { version: 2 }, true, deps);
  const filter = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    timezone: "Europe/Bucharest", limit: "1", status: "scheduled" };
  const page = await listPlanner(f.db, p.owner, p.tenant, filter, deps);
  const next = await listPlanner(f.db, p.owner, p.tenant, { ...filter, cursor: page.nextCursor }, deps);
  expect(Object.values(page.days).flat()[0].id).not.toBe(Object.values(next.days).flat()[0].id);
  expect(Object.values(page.weeks).flat()[0]).toMatchObject({ draftId: first.draft.id, displayTimezone: "Europe/Bucharest", counters: null });
  expect((await listUnscheduledDrafts(f.db, p.owner, p.tenant, { platform: "facebook" }, deps)).drafts.length).toBeGreaterThan(0);
});

it("keeps partial results per destination, retries a definitively failed child with its original key and allows an edit copy", async () => {
  const { draft } = await save(document([account("facebook"), account("threads")]));
  const queued = await submitNow(draft.id, draft.version);
  const [first] = queued.draft.destinations;
  // Hold one account unavailable at dispatch. The other still publishes.
  await f.admin.query("update social_connections set health = 'failing' where id = $1", [first.connectionId]);
  expect(await run()).toMatchObject({ published: 1 });
  await f.admin.query("update social_connections set health = 'healthy' where id = $1", [first.connectionId]);
  const partial = (await read(draft.id)).draft;
  const failure = partial.destinations.find(item => item.status === "failed")!;
  expect(failure).toMatchObject({ lastErrorCode: "CONNECTION_UNAVAILABLE", retryable: true });
  const copy = await change(draft.id, { action: "editAfterAttempt", version: partial.version });
  expect(copy.draft.document.connectionIds).toEqual([failure.connectionId]);
  const key = (await f.admin.query("select idempotency_key from social_posts where id=$1", [failure.id])).rows[0].idempotency_key;
  await change(draft.id, { action: "retry", version: partial.version, deliveries: [{ id: failure.id, version: failure.version }] });
  expect(await run()).toMatchObject({ published: 1 });
  expect(fake.calls.filter(call => call.method === "publishPost").at(-1)?.key).toBe(key);
  expect((await read(draft.id)).draft.destinations.map(item => item.status)).toEqual(["published", "published"]);
});

it("releases ready files at dispatch, retries a fresh URL and keeps an ambiguous outcome unknown", async () => {
  const fileId = await readyImage();
  const { draft } = await saveDraft(f.db, p.owner, p.tenant, { ...document([account("instagram")]), media: [{ fileId, altText: "Church doors" }] }, deps);
  await submitNow(draft.id, 1);
  const callCount = fake.calls.length;
  const expired = async () => ({ url: "https://expiry.example.test/test", expiresAt: new Date(0) });
  expect(await run({ releaseMedia: expired })).toMatchObject({ retried: 1 });
  expect(fake.calls).toHaveLength(callCount);
  const post = (await read(draft.id)).draft.destinations[0];
  expect(post.lastErrorCode).toBe("MEDIA_URL_EXPIRED");
  await f.admin.query("update social_posts set next_attempt_at=now(),version=version+1 where id=$1", [post.id]);
  fake.fail("publishPost", "UNAVAILABLE");
  const live = async () => ({ url: "https://release.example.test/fresh.jpg", expiresAt: new Date(Date.now() + 60_000) });
  expect(await run({ releaseMedia: live })).toMatchObject({ unknown: 1 });
  expect((await read(draft.id)).draft.destinations[0]).toMatchObject({ status: "unknown", retryable: false });
  expect(await run({ releaseMedia: live })).toMatchObject({ claimed: 0 });
  const correlationKey = fake.calls.filter(call => call.method === "publishPost").at(-1)?.key;
  const receipt = await receiveSocialWebhook(f.db, signedRequest(event("social-reconciled", "post.published", {
    accountRef: "instagram", subjectRef: "verified-late-ref", correlationKey,
  })), "fake", deps);
  expect(receipt.status).toBe(202);
  await drainJobs(f.db, p.owner, p.tenant, "social-test");
  expect((await read(draft.id)).draft.destinations[0].status).toBe("published");
});

it("resumes multipart uploads with trusted metadata and a clean scan before making a file ready", async () => {
  const storage = {
    startMultipart: vi.fn(async () => "upload-test"),
    presignPart: vi.fn(async () => ({ url: "https://upload.example.test/part", method: "PUT" as const, expiresIn: 300, headers: {} })),
    completeMultipart: vi.fn(async () => {}), abortMultipart: vi.fn(async () => {}),
    presignUpload: vi.fn(), inspect: vi.fn(), presignDownload: vi.fn(),
  } satisfies SocialUploadStorage;
  const size = 70 * 1024 * 1024, checksum = "a".repeat(64);
  const { file, upload } = await createSocialUpload(f.db, p.owner, p.tenant, { name: "story.mp4", size, checksum, mime: "video/mp4" }, deps);
  expect(upload).toMatchObject({ kind: "multipart", partCount: 3 });
  await expect(signSocialUpload(f.db, p.admin, p.tenant, file.id, { partNumber: 1 }, storage, deps)).rejects.toMatchObject({ status: 404 });
  await signSocialUpload(f.db, p.owner, p.tenant, file.id, { partNumber: 1 }, storage, deps);
  await signSocialUpload(f.db, p.owner, p.tenant, file.id, { partNumber: 3 }, storage, deps);
  expect(storage.startMultipart).toHaveBeenCalledTimes(1);
  expect(storage.presignPart.mock.calls.at(-1)).toEqual([fileKey(p.tenant, file.id), "upload-test", 3, 6 * 1024 * 1024]);
  const parts = [1, 2, 3].map(partNumber => ({ partNumber, etag: "b".repeat(32) }));
  const inspectMedia = async () => ({ checksum, size, mime: "video/mp4", metadata: { durationMs: 42_000, width: 1080, height: 1920 } });
  const unscanned = await confirmSocialUpload(f.db, p.owner, p.tenant, file.id, { parts }, { storage, inspectMedia }, deps);
  expect(unscanned.file.status).toBe("uploaded");
  const ready = await confirmSocialUpload(f.db, p.owner, p.tenant, file.id, {}, { storage, inspectMedia, scanner: { scan: async () => "clean" } }, deps);
  expect(ready.file).toMatchObject({ status: "ready", mediaMetadata: { durationMs: 42_000, width: 1080, height: 1920 } });
  expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
  const story = await saveDraft(f.db, p.owner, p.tenant, { type: "story", content: "", connectionIds: [account("instagram")], media: [{ fileId: file.id }] }, deps);
  expect(story.destinations[0].media[0]).toMatchObject({ accepted: true });
});

it("publishes images, a GIF, mixed video, a short and a document through the fake with a fresh signed release", async () => {
  const templates = [
    { mime: "image/jpeg", name: "still.jpg", metadata: { width: 1080, height: 1080 } },
    { mime: "image/gif", name: "motion.gif", metadata: { width: 640, height: 480 } },
    { mime: "video/mp4", name: "short.mp4", metadata: { width: 1080, height: 1920, durationMs: 10_000 } },
    { mime: "application/pdf", name: "handout.pdf", metadata: {} },
    { mime: "text/vtt", name: "caption.vtt", metadata: {} },
  ];
  const [image, gif, video, pdf, subtitle] = await Promise.all(templates.map(async file => {
    const id = randomUUID();
    await f.admin.query(`insert into files (id,tenant_id,owner_id,key,name,mime,size,checksum,status,social_upload,media_metadata)
      values ($1,$2,$3,$4,$5,$6,1024,$7,'ready',true,$8)`, [id, p.tenant, p.owner, fileKey(p.tenant, id),
      file.name, file.mime, "b".repeat(64), file.metadata]);
    return { fileId: id };
  }));
  const body = {
    ...document([account("instagram"), account("twitter"), account("linkedin"), account("youtube")]), media: [image, video],
    variants: {
      twitter: { mode: "custom", media: [gif] },
      linkedin: { mode: "custom", media: [pdf] },
      youtube: { mode: "custom", media: [video], options: { title: "Short video", format: "short", coverFileId: image.fileId, subtitles: [{ fileId: subtitle.fileId, language: "en" }] } },
    },
  };
  const { draft } = await saveDraft(f.db, p.owner, p.tenant, body, deps);
  await submitNow(draft.id, 1);
  const media = async ({ id }: { id: string }) => ({ url: `https://release.example.test/${id}`, expiresAt: new Date(Date.now() + 60_000) });
  expect(await run({ releaseMedia: media })).toMatchObject({ published: 4 });
  const published = Array.from(fake.posts.values()).slice(-4).map(entry => [entry.request.platform, entry.request] as const);
  const requests = Object.fromEntries(published);
  expect(requests.instagram.media.map(item => item.kind)).toEqual(["image", "video"]);
  expect(requests.twitter.media[0].kind).toBe("gif");
  expect(requests.linkedin.media[0].kind).toBe("document");
  expect(requests.youtube).toMatchObject({ options: { format: "short" }, media: [{ kind: "video", thumbnailUrl: expect.stringContaining(image.fileId), subtitles: [{ url: expect.stringContaining(subtitle.fileId), language: "en" }] }] });
  expect(published.every(([, request]) => request.scheduledFor === undefined)).toBe(true);
});

it("creates a single Harvest-owned repeat after confirmed publishing and cancels it with the group", async () => {
  const { draft } = await saveDraft(f.db, p.owner, p.tenant, { ...document(), variants: { facebook: { mode: "same",
    options: { repost: { intervalDays: 7, stop: { kind: "count", copies: 1 } } } } } }, deps);
  await submitNow(draft.id, 1);
  expect(await run()).toMatchObject({ published: 1 });
  const result = (await read(draft.id)).draft;
  expect(result.destinations).toHaveLength(2);
  expect(result.destinations.find(child => child.repeatNumber === 1)).toMatchObject({
    status: "scheduled", scheduleId: null, scheduledFor: expect.any(Date),
  });
  const cancelled = await change(draft.id, { action: "cancel", version: result.version });
  expect(cancelled.draft.destinations.find(child => child.repeatNumber === 1)?.status).toBe("cancelled");
});
