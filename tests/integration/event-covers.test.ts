import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { createCommunity } from "../../src/server/communities";
import { confirmEventCoverUpload, createEventCoverUpload, getEventCoverUrl, setEventCover } from "../../src/server/event-covers";
import { getEvent, saveEvent, setEventPlacement, transitionEvent } from "../../src/server/events";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { testDatabase } from "../database";

vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, foreignTenant: string, circle: string;
const owner = "cover-owner", admin = "cover-admin", reader = "cover-reader", viewer = "cover-viewer", plain = "cover-plain", foreign = "cover-foreign";
const intent = { kind: "cover", mime: "image/png", name: "sample.png", size: 12, checksum: "a".repeat(64) };
const missing = { status: 404, message: "File not found." };
const clean = { scan: vi.fn().mockResolvedValue("clean") };
const infected = { scan: vi.fn().mockResolvedValue("infected") };

function fakeStorage() {
  const adapter = {
    presignUpload: vi.fn().mockResolvedValue({ url: "https://storage.example.test/upload", method: "PUT", expiresIn: 300, headers: {} }),
    inspect: vi.fn().mockResolvedValue({ size: intent.size, mime: intent.mime, checksum: intent.checksum }),
    presignDownload: vi.fn((key: string) => Promise.resolve("https://storage.example.test/" + key.split("/").at(-1))),
  };
  return { adapter, storage: vi.fn(() => adapter) };
}

async function draft(tenantId = tenant, user = owner) {
  const eventId = randomUUID();
  await saveEvent(f.db, user, tenantId, eventId, { version: 0, title: "Test event", timeZone: "UTC",
    startsAt: new Date(Date.now() + 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() });
  return { tenantId, eventId };
}
async function ready(scope: Awaited<ReturnType<typeof draft>>, storage: ReturnType<typeof fakeStorage>["storage"], user = owner) {
  const { file } = await createEventCoverUpload(f.db, user, scope, intent, storage);
  const uploaded = await confirmEventCoverUpload(f.db, user, scope, file.id, storage, clean);
  expect(uploaded.status).toBe("ready");
  return file.id;
}

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, admin, reader, viewer, plain, foreign].map(id => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(f.db, owner, "Image ministry", "church")).tenantId;
  foreignTenant = (await createWorkspace(f.db, foreign, "Other image ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, admin + "@example.test", "admin");
  await putMember(f.db, owner, tenant, viewer + "@example.test", "viewer");
  await putMember(f.db, owner, tenant, plain + "@example.test", "member");
  circle = (await createCommunity(f.db, owner, tenant, { name: "Image events", slug: "event-images" })).id;
  await f.admin.query("update communities set status='published' where id=$1", [circle]);
  await f.admin.query("insert into community_memberships(tenant_id,community_id,user_id,status) values($1,$2,$3,'active')", [tenant, circle, reader]);
  await f.admin.query("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values($1,$2,'community',$3,'admin_grant')",
    [tenant, reader, circle]);
});
afterAll(async () => { await f?.close(); });

it("rejects non-images and oversize uploads before storage, and uses a scoped key", async () => {
  const scope = await draft();
  const { adapter, storage } = fakeStorage();
  for (const input of [{ ...intent, mime: "application/pdf", name: "document.pdf" }, { ...intent, size: 10 * 1024 * 1024 + 1 },
    { ...intent, checksum: "wrong" }, { ...intent, kind: "attachment" }]) {
    await expect(createEventCoverUpload(f.db, owner, scope, input, storage)).rejects.toMatchObject({ name: "ZodError" });
  }
  await expect(createEventCoverUpload(f.db, viewer, scope, intent, storage)).rejects.toMatchObject(missing);
  expect(storage).not.toHaveBeenCalled();
  const { file } = await createEventCoverUpload(f.db, admin, scope, intent, storage);
  expect(adapter.presignUpload).toHaveBeenCalledWith(`workspaces/${tenant}/events/${scope.eventId}/files/${file.id}`,
    expect.objectContaining({ mime: "image/png", visibility: "private" }));
  expect(file).not.toHaveProperty("key");
});

it("never attaches unscanned or quarantined images and permits a clean retry after a skipped scan", async () => {
  const scope = await draft();
  const { adapter, storage } = fakeStorage();
  const pending = (await createEventCoverUpload(f.db, owner, scope, intent, storage)).file.id;
  await expect(setEventCover(f.db, owner, scope, { fileId: pending, version: 1 })).rejects.toMatchObject(missing);
  const skipped = await confirmEventCoverUpload(f.db, owner, scope, pending, storage);
  expect(skipped.status).toBe("uploaded");
  await expect(setEventCover(f.db, owner, scope, { fileId: pending, version: 1 })).rejects.toMatchObject(missing);
  const bad = (await createEventCoverUpload(f.db, owner, scope, intent, storage)).file.id;
  expect((await confirmEventCoverUpload(f.db, owner, scope, bad, storage, infected)).status).toBe("quarantined");
  await expect(setEventCover(f.db, owner, scope, { fileId: bad, version: 1 })).rejects.toMatchObject(missing);
  const mismatch = (await createEventCoverUpload(f.db, owner, scope, intent, storage)).file.id;
  adapter.inspect.mockResolvedValueOnce({ size: intent.size, mime: intent.mime, checksum: "b".repeat(64) });
  expect((await confirmEventCoverUpload(f.db, owner, scope, mismatch, storage, clean)).status).toBe("quarantined");
  await expect(confirmEventCoverUpload(f.db, admin, scope, pending, storage, clean)).rejects.toMatchObject(missing);
  expect((await confirmEventCoverUpload(f.db, owner, scope, pending, storage, clean)).status).toBe("ready");
  await setEventCover(f.db, owner, scope, { fileId: pending, version: 1 });
  expect(adapter.presignDownload).not.toHaveBeenCalled();
});

it("signs a ready cover only for viewers of the canonical event, with staff-only draft access", async () => {
  const scope = await draft();
  const otherEvent = await draft();
  const otherMinistry = await draft(foreignTenant, foreign);
  const { adapter, storage } = fakeStorage();
  const file = await ready(scope, storage);
  const otherFile = await ready(otherEvent, storage);
  const foreignFile = await ready(otherMinistry, storage, foreign);
  for (const fileId of [otherFile, foreignFile, randomUUID()]) {
    await expect(setEventCover(f.db, owner, scope, { fileId, version: 1 })).rejects.toMatchObject(missing);
  }
  await expect(f.admin.query("update events set cover_file_id=$1 where id=$2", [otherFile, scope.eventId])).rejects.toMatchObject({ code: "23514" });
  await setEventCover(f.db, admin, scope, { fileId: file, version: 1 });
  await setEventPlacement(f.db, owner, tenant, scope.eventId, circle, true);
  await expect(getEventCoverUrl(f.db, reader, scope, storage)).rejects.toMatchObject(missing);
  await expect(getEventCoverUrl(f.db, owner, scope, storage)).resolves.toEqual({ url: "https://storage.example.test/" + file, expiresIn: 60 });
  expect(adapter.presignDownload).toHaveBeenCalledExactlyOnceWith(`workspaces/${tenant}/events/${scope.eventId}/files/${file}`, intent.name, { inlineImage: intent.mime });
  await transitionEvent(f.db, owner, tenant, scope.eventId, { action: "publish", version: 2 });
  expect(await getEvent(f.db, reader, tenant, scope.eventId)).toMatchObject({ coverFileId: file });
  expect(await getEventCoverUrl(f.db, reader, scope, storage)).toMatchObject({ expiresIn: 60 });
  for (const who of [viewer, plain, foreign]) {
    await expect(getEventCoverUrl(f.db, who, scope, storage)).rejects.toMatchObject(missing);
  }
  for (const who of [viewer, plain]) {
    await expect(withTenant(f.db, who, tenant, "workspace:read", tx => tx.execute(sql`select * from event_files`)))
      .rejects.toMatchObject({ cause: { code: "42501" } });
  }
});

it("retires prior covers, queues one cleanup for each, and clears its reference on file deletion", async () => {
  const scope = await draft();
  const { storage } = fakeStorage();
  const first = await ready(scope, storage);
  const second = await ready(scope, storage);
  const last = await ready(scope, storage);
  await setEventCover(f.db, owner, scope, { fileId: first, version: 1 });
  const update = { fileId: second, version: 2 };
  expect(await setEventCover(f.db, owner, scope, update)).toEqual({ coverFileId: second, version: 3 });
  expect(await setEventCover(f.db, owner, scope, update)).toEqual({ coverFileId: second, version: 3 });
  await expect(setEventCover(f.db, owner, scope, { fileId: first, version: 3 })).rejects.toMatchObject(missing);
  expect(await getEventCoverUrl(f.db, owner, scope, storage)).toMatchObject({ url: "https://storage.example.test/" + second });
  expect(await setEventCover(f.db, owner, scope, { fileId: null, version: 3 })).toEqual({ coverFileId: null, version: 4 });
  await expect(getEventCoverUrl(f.db, owner, scope, storage)).rejects.toMatchObject(missing);

  const { rows } = await f.admin.query(`select payload, dispatched_at, scheduled_for > created_at as delayed
    from outbox_events where kind='events.cover_cleanup' and payload->>'eventId'=$1 order by created_at`, [scope.eventId]);
  expect(rows).toEqual([first, second].map(fileId => ({ payload: { eventId: scope.eventId, fileId }, dispatched_at: null, delayed: true })));
  expect((await f.admin.query("select count(*)::int as n from event_files where event_id=$1 and retired_at is not null", [scope.eventId])).rows)
    .toEqual([{ n: 2 }]);

  await setEventCover(f.db, owner, scope, { fileId: last, version: 4 });
  await f.admin.query("delete from event_files where id=$1", [last]);
  expect(await getEvent(f.db, owner, tenant, scope.eventId)).toMatchObject({ coverFileId: null });
});
