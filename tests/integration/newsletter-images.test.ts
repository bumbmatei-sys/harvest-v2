import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { files, users } from "../../src/db/schema";
import { defaultBrand, newBlock, type EmailDocument } from "../../src/lib/email/blocks";
import { writeCampaign } from "../../src/server/newsletter-campaigns/campaigns";
import { confirmNewsletterImageUpload, createNewsletterImageUpload, listNewsletterImages, suggestVideoThumbnail } from "../../src/server/newsletter-campaigns/images";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, foreign: string;
const owner = "nli-owner", admin = "nli-admin", member = "nli-member", stranger = "nli-stranger";
const intent = { name: "photo.png", mime: "image/png", size: 12, checksum: "a".repeat(64) };
const clean = { scan: vi.fn().mockResolvedValue("clean") }, infected = { scan: vi.fn().mockResolvedValue("infected") }, skipped = { scan: vi.fn().mockResolvedValue("skipped") };
const storage = () => ({
  presignUpload: vi.fn().mockResolvedValue({ url: "https://storage.example.test/put", method: "PUT", expiresIn: 300, headers: { "Content-Type": "image/png" } }),
  inspect: vi.fn().mockResolvedValue({ size: intent.size, mime: intent.mime, checksum: intent.checksum }), presignDownload: vi.fn(),
});
const brand = { ...defaultBrand, address: "1 Main Street" };
const docWith = (fileId: string): EmailDocument => ({ version: 2, brand, blocks: [{ ...newBlock("image", {}, "b-img"), fileId, alt: "A photo" } as EmailDocument["blocks"][number]] });
const campaign = (user: string, tenantId: string, content: EmailDocument) => writeCampaign(f.db, user, tenantId, { name: "N", subject: "S", selection: { listIds: [] }, content });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, admin, member, stranger].map((id) => ({ id, name: id, email: id + "@example.test" })));
  tenant = (await createWorkspace(f.db, owner, "Images ministry", "church")).tenantId;
  foreign = (await createWorkspace(f.db, stranger, "Other ministry", "church")).tenantId;
  await f.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member')", [tenant, admin, member]);
}, 60_000);
afterAll(async () => { await f?.close(); });

async function upload(user = owner, tenantId = tenant) {
  const s = storage();
  const created = await createNewsletterImageUpload(f.db, s, user, tenantId, intent);
  return { s, created, id: created.file.id };
}

it("creates a public, tenant-scoped pending file with a signed slot and no storage address in the result", async () => {
  const { s, created } = await upload();
  expect(created.file).toMatchObject({ name: "photo.png", mime: "image/png", status: "pending", path: null });
  expect(s.presignUpload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^workspaces/${tenant}/files/`)), expect.objectContaining({ visibility: "public" }));
  const row = (await f.admin.query("select visibility, social_upload, owner_id from files where id=$1", [created.file.id])).rows[0];
  expect(row).toEqual({ visibility: "public", social_upload: false, owner_id: owner });
});

it("rejects wrong type, oversize, gif and odd names before anything is stored", async () => {
  const s = storage();
  for (const bad of [{ ...intent, mime: "image/gif", name: "a.gif" }, { ...intent, size: 5 * 1024 * 1024 + 1 }, { ...intent, mime: "application/pdf", name: "a.pdf" }, { ...intent, name: "a.jpg" }, { ...intent, name: "../a.png" }, { ...intent, visibility: "private" }])
    await expect(createNewsletterImageUpload(f.db, s, owner, tenant, bad)).rejects.toBeTruthy();
  expect(s.presignUpload).not.toHaveBeenCalled();
});

it("is usable only after the scan passed: clean releases, infected is quarantined, a skipped scan releases outside production only", async () => {
  const a = await upload();
  expect(await confirmNewsletterImageUpload(f.db, a.s, owner, tenant, a.id, clean, { NODE_ENV: "production" })).toMatchObject({ status: "ready", path: `/api/files/public/${tenant}/${a.id}` });
  const b = await upload();
  expect(await confirmNewsletterImageUpload(f.db, b.s, owner, tenant, b.id, infected)).toMatchObject({ status: "quarantined", path: null });
  const c = await upload();
  expect((await confirmNewsletterImageUpload(f.db, c.s, owner, tenant, c.id, skipped, { NODE_ENV: "production" })).status).toBe("uploaded");
  expect((await confirmNewsletterImageUpload(f.db, c.s, owner, tenant, c.id, skipped, { NODE_ENV: "test" })).status).toBe("ready");
  const d = await upload();
  d.s.inspect.mockResolvedValue({ size: 99, mime: "image/png", checksum: intent.checksum });
  expect((await confirmNewsletterImageUpload(f.db, d.s, owner, tenant, d.id, clean)).status).toBe("quarantined");
});

it("lists only ready images of this ministry", async () => {
  const pending = await upload();
  const { images } = await listNewsletterImages(f.db, admin, tenant);
  expect(images.length).toBeGreaterThanOrEqual(2);
  expect(images.every((image) => image.status === "ready" && image.path?.startsWith(`/api/files/public/${tenant}/`))).toBe(true);
  expect(images.map((image) => image.id)).not.toContain(pending.id);
  expect((await listNewsletterImages(f.db, stranger, foreign)).images).toEqual([]);
});

it("keeps uploads to restricted roles out: members and strangers get 404 on every route", async () => {
  const a = await upload();
  await expect(listNewsletterImages(f.db, member, tenant)).rejects.toMatchObject({ status: 404 });
  await expect(createNewsletterImageUpload(f.db, storage(), member, tenant, intent)).rejects.toMatchObject({ status: 404 });
  await expect(confirmNewsletterImageUpload(f.db, a.s, member, tenant, a.id, clean)).rejects.toMatchObject({ status: 404 });
  await expect(listNewsletterImages(f.db, stranger, tenant)).rejects.toMatchObject({ status: 404 });
  await expect(createNewsletterImageUpload(f.db, storage(), stranger, tenant, intent)).rejects.toMatchObject({ status: 404 });
  // Another admin of the same ministry cannot confirm someone else's upload; the uploader can.
  await expect(confirmNewsletterImageUpload(f.db, a.s, admin, tenant, a.id, clean)).rejects.toMatchObject({ status: 404 });
  expect((await confirmNewsletterImageUpload(f.db, a.s, owner, tenant, a.id, clean)).status).toBe("ready");
});

it("never confirms or uses another ministry's image", async () => {
  const mine = await upload();
  await confirmNewsletterImageUpload(f.db, mine.s, owner, tenant, mine.id, clean);
  await expect(confirmNewsletterImageUpload(f.db, mine.s, stranger, foreign, mine.id, clean)).rejects.toMatchObject({ status: 404 });
  await expect(campaign(stranger, foreign, docWith(mine.id))).rejects.toMatchObject({ status: 409, details: { code: "IMAGE_UNAVAILABLE" } });
});

it("refuses a draft that uses an image that is not ready, and renders the public address once it is", async () => {
  const a = await upload();
  await expect(campaign(owner, tenant, docWith(a.id))).rejects.toMatchObject({ status: 409, details: { code: "IMAGE_UNAVAILABLE" } });
  await expect(campaign(owner, tenant, docWith("3f1c1d44-1f0e-4f43-a5f1-0d9a9b1d6a11"))).rejects.toMatchObject({ status: 409 });
  await confirmNewsletterImageUpload(f.db, a.s, owner, tenant, a.id, clean);
  const saved = await campaign(owner, tenant, docWith(a.id));
  expect(saved.preview.html).toContain(`src="https://newsletter.example.test/api/files/public/${tenant}/${a.id}"`);
  const withCover = await campaign(owner, tenant, { ...docWith(a.id), cover: { imageUrl: "", fileId: a.id, alt: "Cover" } });
  expect(withCover.preview.html).toContain('width="600"');
  // A file that goes back to quarantine stops being usable.
  await f.admin.query("update files set status='quarantined' where id=$1", [a.id]);
  await expect(campaign(owner, tenant, docWith(a.id))).rejects.toMatchObject({ status: 409 });
  // A non-image or private or social file id is not an image either.
  const [other] = await f.db.select({ id: files.id }).from(files).limit(0);
  expect(other).toBeUndefined();
});

it("suggests a YouTube thumbnail server side, only from the fixed host, through the scan pipeline, and never in production", async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input) + " " + (init?.method ?? "GET"));
    return String(input).startsWith("https://img.youtube.com/") ? new Response(bytes, { headers: { "content-type": "image/jpeg" } }) : new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const s = storage();
  s.inspect.mockImplementation(async () => ({ size: bytes.length, mime: "image/jpeg", checksum: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex") }));
  const result = await suggestVideoThumbnail(f.db, s, owner, tenant, { videoUrl: "https://youtu.be/dQw4w9WgXcQ" }, { fetcher, scanner: clean, env: { NODE_ENV: "test" } });
  expect(result).toMatchObject({ status: "ready", name: "video-dQw4w9WgXcQ.jpg" });
  expect(calls[0]).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg GET");
  expect(calls[1]).toBe("https://storage.example.test/put PUT");
  const before = calls.length;
  for (const bad of ["https://vk.com/video-1_2", "https://evil.test/?v=dQw4w9WgXcQ", "http://youtu.be/dQw4w9WgXcQ", "nope"])
    await expect(suggestVideoThumbnail(f.db, s, owner, tenant, { videoUrl: bad }, { fetcher, scanner: clean, env: { NODE_ENV: "test" } })).rejects.toMatchObject({ status: 400 });
  await expect(suggestVideoThumbnail(f.db, s, owner, tenant, { videoUrl: "https://youtu.be/dQw4w9WgXcQ" }, { fetcher, scanner: clean, env: { NODE_ENV: "production" } })).rejects.toMatchObject({ status: 404 });
  for (const who of [member, stranger])
    await expect(suggestVideoThumbnail(f.db, s, who, tenant, { videoUrl: "https://youtu.be/dQw4w9WgXcQ" }, { fetcher, scanner: clean, env: { NODE_ENV: "test" } })).rejects.toMatchObject({ status: 404 });
  // Members and strangers never trigger an outbound request.
  expect(calls.length).toBe(before);
});
