import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { fileKey } from "../../src/lib/files";
import { socialUploadLimits } from "../../src/lib/social/upload-limits";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { createSocialUpload, getSocialUploadUsage } from "../../src/server/files/social-upload";
import { changeDraft, saveDraft } from "../../src/server/social/drafts";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { postingMediaLifetime, POSTING_MEDIA_LINK_SECONDS, readPostingMedia } from "../../src/server/social/posting-media";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { linkConnection } from "../../src/server/social/service";
import { sweepSocialUploads } from "../../src/server/social/social-upload-cleanup";
import { testDatabase } from "../database";
import { CANARY, depsFor, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let network: ReturnType<typeof noNetwork>;
let connection: string, youtube: string;
const fake = new FakeProvider({ validSecret: CANARY, accounts: [
  { accountRef: "instagram", platform: "instagram", displayName: "Page" }, { accountRef: "youtube", platform: "youtube", displayName: "Channel" },
] });
const deps = depsFor(fake);
const checksum = "a".repeat(64);
const image = { name: "image.jpg", mime: "image/jpeg", size: 1_024, checksum };
const storage = { deleteObject: vi.fn<(key: string) => Promise<void>>(async () => {}), abortMultipart: vi.fn<(key: string, uploadId: string) => Promise<void>>(async () => {}) };

async function seedFile(options: {
  status: "ready" | "pending" | "uploaded"; size?: number; old?: boolean; multipart?: string; tenant?: string;
}) {
  const id = randomUUID(), tenant = options.tenant ?? people.tenant, actor = tenant === people.tenant ? people.owner : people.outsider;
  const key = fileKey(tenant, id);
  await f.admin.query(`insert into files (id,tenant_id,owner_id,key,name,mime,size,checksum,status,social_upload,media_metadata,created_at,multipart_id)
    values ($1,$2,$3,$4,'photo.jpg','image/jpeg',$5,$6,$7,true,$8,now() - make_interval(hours=>$9),$10)`,
    [id, tenant, actor, key, options.size ?? 1024, checksum, options.status, options.status === "ready" ? { width: 1080, height: 1080 } : null,
      options.old ? 13 : 0, options.multipart ?? null]);
  return { id, key };
}
async function makeDraft(file: string) {
  const { draft } = await saveDraft(f.db, people.owner, people.tenant, {
    type: "post", content: "Sunday welcome", connectionIds: [connection], media: [{ fileId: file }],
  }, deps);
  return draft;
}
async function submit(file: string) {
  const draft = await makeDraft(file);
  const review = await changeDraft(f.db, people.owner, people.tenant, draft.id, { action: "review", version: draft.version }, deps);
  return (await changeDraft(f.db, people.owner, people.tenant, draft.id, {
    action: "publishNow", version: review.draft.version, reviewToken: review.review!.token, timezone: "UTC",
  }, deps)).draft;
}
const run = () => runSocialPublisher(f.workerPool, () => fake, { postingMediaOrigin: "https://fixture.invalid" });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  people = await seedPeople(f, "smedia");
  useTestKeys();
  network = noNetwork();
  connection = (await linkConnection(f.db, people.owner, people.tenant, { accountRef: "instagram", provider: "fake", credential: CANARY }, deps)).connection.id;
  youtube = (await linkConnection(f.db, people.owner, people.tenant, { accountRef: "youtube", provider: "fake", credential: CANARY }, deps)).connection.id;
});
afterEach(() => expect(network).not.toHaveBeenCalled());
afterAll(async () => { network?.mockRestore(); useKeyProvider(null); await f?.close(); });

it("bounds new files by the smaller of the default and selected destination and provides per-destination errors", async () => {
  await expect(createSocialUpload(f.db, people.owner, people.tenant, {
    name: "video.mp4", mime: "video/mp4", size: socialUploadLimits.fileBytes + 1, checksum,
    destinations: [{ connectionId: youtube, type: "post", format: "short" }],
  }, deps)).rejects.toMatchObject({ details: { code: "SOCIAL_UPLOAD_FILE_LIMIT", maxBytes: 4_000_000_000 } });
  await expect(createSocialUpload(f.db, people.owner, people.tenant, {
    ...image, size: 8 * 1024 ** 2 + 1, destinations: [{ connectionId: connection, type: "story" }],
  }, deps)).rejects.toMatchObject({ details: { code: "SOCIAL_UPLOAD_NO_ACCEPTING_DESTINATION",
    destinations: [{ maxBytes: 8 * 1024 ** 2, warning: "MEDIA_TOO_LARGE" }] } });
  const { file, upload, destinations } = await createSocialUpload(f.db, people.owner, people.tenant, {
    name: "video.mp4", mime: "video/mp4", size: 4_000_000_000, checksum, destinations: [{ connectionId: youtube, type: "post", format: "short" }],
  }, deps);
  expect(destinations).toEqual([expect.objectContaining({ accepted: true, maxBytes: 4_000_000_000 })]);
  expect(upload).toMatchObject({ kind: "multipart", partSize: 32 * 1024 * 1024 });
  await f.admin.query("delete from files where id=$1", [file.id]);
});

it("serializes simultaneous upload starts and frees a slot", async () => {
  const pool = new Pool({ connectionString: f.appURL, max: 8 });
  const make = async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)", [people.tenant, people.owner]);
      const id = randomUUID();
      await client.query(`insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,social_upload)
        values($1,$2,$3,$4,'file.jpg','image/jpeg',1024,$5,true)`, [id, people.tenant, people.owner, fileKey(people.tenant, id), checksum]);
      await client.query("commit");
      return id;
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  };
  try {
    const simultaneous = await Promise.allSettled(Array.from({ length: 8 }, make));
    const created = simultaneous.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    expect(created).toHaveLength(5);
    expect(simultaneous.filter(result => result.status === "rejected").map(result => result.reason.message))
      .toEqual(Array(3).fill("SOCIAL_UPLOAD_UNFINISHED_LIMIT"));
    await expect(createSocialUpload(f.db, people.owner, people.tenant, image, deps)).rejects.toMatchObject({ details: { code: "SOCIAL_UPLOAD_UNFINISHED_LIMIT" } });
    await f.admin.query("delete from files where id=$1", [created[0]]);
    const retry = await createSocialUpload(f.db, people.owner, people.tenant, image, deps);
    expect(retry.usage.unfinished).toBe(5);
    await f.admin.query("delete from files where id=any($1)", [[...created.slice(1), retry.file.id]]);
  } finally { await pool.end(); }
});

it("warns at 80 percent, enforces the soft total and scopes usage to each ministry", async () => {
  const existing = [];
  for (let i = 0; i < 5; i++) existing.push(await seedFile({ status: "ready", size: socialUploadLimits.fileBytes, tenant: people.other }));
  const usage = () => getSocialUploadUsage(f.db, people.outsider, people.other, deps);
  expect((await usage()).usage).toMatchObject({ usedBytes: 20_000_000_000, level: "warning" });
  expect((await getSocialUploadUsage(f.db, people.owner, people.tenant, deps)).usage.level).toBe("normal");
  existing.push(await seedFile({ status: "ready", size: socialUploadLimits.fileBytes, tenant: people.other }));
  existing.push(await seedFile({ status: "ready", size: 1_000_000_000, tenant: people.other }));
  expect((await usage()).usage).toMatchObject({ usedBytes: 25_000_000_000, level: "limit" });
  await expect(createSocialUpload(f.db, people.outsider, people.other, image, deps)).rejects.toMatchObject({ details: { code: "SOCIAL_UPLOAD_MINISTRY_LIMIT" } });
  await f.admin.query("delete from files where id=any($1)", [existing.map(file => file.id)]);
});

it("uses worker-only cleanup to abort multipart, remove unconfirmed files, and protect drafts, deliveries and ready media", async () => {
  const old = await seedFile({ status: "pending", old: true, multipart: "multipart-fixture" });
  const uploaded = await seedFile({ status: "uploaded", old: true });
  const current = await seedFile({ status: "pending" });
  const active = await seedFile({ status: "pending", old: true });
  await f.admin.query("update files set social_confirm_until=now()+interval '2 minutes' where id=$1", [active.id]);
  const draftMedia = await seedFile({ status: "ready", old: true });
  await makeDraft(draftMedia.id);
  await f.admin.query("update files set status='uploaded' where id=$1", [draftMedia.id]);
  const deliveryMedia = await seedFile({ status: "ready", old: true });
  const draft = await submit(deliveryMedia.id);
  await f.admin.query("update social_drafts set status='cancelled',version=version+1 where id=$1", [draft.id]);
  await f.admin.query("update files set status='uploaded' where id=$1", [deliveryMedia.id]);
  const ready = await seedFile({ status: "ready", old: true });
  await expect(f.pool.query("select public.social_upload_cleanup_pending()")).rejects.toMatchObject({ code: "42501" });
  await expect(f.workerPool.query("select * from files")).rejects.toMatchObject({ code: "42501" });
  expect(await sweepSocialUploads(f.workerPool, storage)).toEqual({ deleted: 2, failed: 0, backlog: false });
  expect(storage.abortMultipart.mock.calls).toEqual([[old.key, "multipart-fixture"]]);
  expect(storage.deleteObject.mock.calls.map(([key]) => key).sort()).toEqual([old.key, uploaded.key].sort());
  expect((await f.admin.query("select id from files where id=any($1)", [[current.id, active.id, draftMedia.id, deliveryMedia.id, ready.id]])).rowCount).toBe(5);
  expect(await sweepSocialUploads(f.workerPool, storage)).toEqual({ deleted: 0, failed: 0, backlog: false });
  await f.admin.query("update social_posts set status='cancelled',version=version+1 where draft_id=$1", [draft.id]);
});

it("mints a fresh, bounded posting link after a fetch failure and denies expiry, cancellation, retirement and forgery", async () => {
  const file = await seedFile({ status: "ready" });
  const draft = await submit(file.id);
  const links: string[] = [];
  const read = vi.fn(async () => new Response("fixture bytes"));
  const requestLink = (link: string, now = Date.now) => readPostingMedia(() => f.db, new Request(link), new URL(link).pathname.split("/").at(-1)!,
    () => ({ read }), true, now);
  const original = fake.publishPost.bind(fake);
  const publishing = vi.spyOn(fake, "publishPost").mockImplementation(async (credential, request) => {
    const link = request.media[0].url;
    links.push(link);
    expect((await requestLink(link)).status).toBe(200);
    if (links.length === 1) {
      fake.fail("publishPost", "MEDIA_FETCH_FAILED");
      return original(credential, request);
    }
    return { ...(await original(credential, request)), status: "publishing" };
  });
  try {
    expect(await run()).toMatchObject({ retried: 1 });
    const first = (await f.admin.query("select last_error_code from social_posts where id=$1", [draft.destinations[0].id])).rows[0];
    expect(first.last_error_code).toBe("MEDIA_FETCH_FAILED");
    expect((await requestLink(links[0])).status).toBe(404);
    await f.admin.query("update social_posts set next_attempt_at=now(),version=version+1 where id=$1", [draft.destinations[0].id]);
    expect(await run()).toMatchObject({ accepted: 1 });
    expect(links[1]).not.toBe(links[0]);
    expect((await requestLink(links[1], () => Date.now() + POSTING_MEDIA_LINK_SECONDS * 1000)).status).toBe(404);
    expect((await requestLink(links[1] + "a")).status).toBe(404);
    expect((await requestLink(links[1])).status).toBe(200);
    await f.admin.query("update files set social_retired_at=now() where id=$1", [file.id]);
    expect((await requestLink(links[1])).status).toBe(404);
    const other = await seedFile({ status: "ready" });
    const second = await submit(other.id);
    expect(await run()).toMatchObject({ accepted: 1 });
    await changeDraft(f.db, people.owner, people.tenant, second.id, { action: "cancel", version: second.version }, deps);
    expect((await requestLink(links[2])).status).toBe(404);
    expect(postingMediaLifetime()).toBe(7200);
    expect(postingMediaLifetime(900)).toBe(900);
  } finally { publishing.mockRestore(); }
});
