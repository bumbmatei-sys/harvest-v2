import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { storageMock } from "../storage-mock";
import { files, users } from "../../src/db/schema";
import { fileKey, publicFilePath } from "../../src/lib/files";
import { S3Storage } from "../../src/server/storage/s3";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { confirmUpload, createUpload, fileDownload, listFiles, publicDownload } from "../../src/server/files/service";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let mock: Awaited<ReturnType<typeof storageMock>>;
let storage: S3Storage;
let tenantA: string, tenantB: string;
const body = Buffer.from("Harvest upload fixture\n");
const input = { name: "report.txt", mime: "text/plain", size: body.length, checksum: createHash("sha256").update(body).digest("hex"), visibility: "private" };
beforeAll(async () => {
  fixture = await testDatabase(); mock = await storageMock(); storage = new S3Storage(mock.config);
  await fixture.db.insert(users).values([
    { id: "alice", name: "Alice", email: "files-alice@example.test" },
    { id: "bob", name: "Bob", email: "files-bob@example.test" },
    { id: "viewer", name: "Viewer", email: "files-viewer@example.test" },
    { id: "member", name: "Member", email: "files-member@example.test" },
  ]);
  tenantA = (await createWorkspace(fixture.db, "alice", "Files A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "bob", "Files B")).tenantId;
  await putMember(fixture.db, "alice", tenantA, "files-viewer@example.test", "viewer");
  await putMember(fixture.db, "alice", tenantA, "files-member@example.test", "member");
});
afterAll(async () => { await mock?.close(); await fixture?.close(); });
async function uploaded(visibility = "private", checksum = input.checksum) {
  const grant = await createUpload(fixture.db, storage, "alice", tenantA, { ...input, visibility, checksum });
  const response = await fetch(grant.upload.url, { method: "PUT", headers: grant.upload.headers, body });
  expect(response.status).toBe(200);
  return grant;
}
describe("files: PostgreSQL forced RLS and membership authorization", () => {
  it("forces RLS and defines a tenant WITH CHECK policy", async () => {
    const { rows: [table] } = await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'files'::regclass");
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const { rows: [policy] } = await fixture.admin.query("select qual, with_check from pg_policies where tablename = 'files' and policyname = 'files_tenant'");
    expect(policy.qual).toContain("app.tenant_id"); expect(policy.with_check).toContain("app.tenant_id");
  });
  it("blocks unscoped and cross-workspace SELECT, INSERT, UPDATE and DELETE", async () => {
    const a = await createUpload(fixture.db, storage, "alice", tenantA, input);
    const b = await createUpload(fixture.db, storage, "bob", tenantB, input);
    expect(await fixture.db.select().from(files)).toEqual([]);
    await withTenant(fixture.db, "alice", tenantA, "workspace:read", async (tx) => {
      expect((await tx.select().from(files)).every((file) => file.tenantId === tenantA)).toBe(true);
      expect(await tx.select().from(files).where(eq(files.id, b.file.id))).toEqual([]);
      expect(await tx.update(files).set({ status: "ready" }).where(eq(files.id, b.file.id)).returning()).toEqual([]);
      expect(await tx.delete(files).where(eq(files.id, b.file.id)).returning()).toEqual([]);
    });
    const id = randomUUID();
    await expect(withTenant(fixture.db, "alice", tenantA, "workspace:read", (tx) => tx.insert(files).values({ ...input, visibility: "private", tenantId: tenantB, ownerId: "bob", id, key: fileKey(tenantB, id) }))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withTenant(fixture.db, "alice", tenantA, "workspace:read", (tx) => tx.update(files).set({ tenantId: tenantB, ownerId: "bob", key: fileKey(tenantB, a.file.id) }).where(eq(files.id, a.file.id)))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(fixture.db.insert(files).values({ ...input, visibility: "private", tenantId: tenantA, ownerId: "alice", id, key: fileKey(tenantA, id) })).rejects.toMatchObject({ cause: { code: "42501" } });
  });
  it("never calls storage signing/inspection for a foreign workspace or file ID", async () => {
    const foreign = await createUpload(fixture.db, storage, "bob", tenantB, input);
    const sign = vi.spyOn(storage, "presignDownload"), upload = vi.spyOn(storage, "presignUpload"), inspect = vi.spyOn(storage, "inspect");
    try {
      await expect(createUpload(fixture.db, storage, "alice", tenantB, input)).rejects.toMatchObject({ status: 403 });
      await expect(fileDownload(fixture.db, storage, "alice", tenantB, foreign.file.id)).rejects.toMatchObject({ status: 403 });
      await expect(fileDownload(fixture.db, storage, "alice", tenantA, foreign.file.id)).rejects.toMatchObject({ status: 404 });
      await expect(confirmUpload(fixture.db, storage, "alice", tenantA, foreign.file.id)).rejects.toMatchObject({ status: 404 });
      await putMember(fixture.db, "bob", tenantB, "files-alice@example.test", "member");
      await expect(fileDownload(fixture.db, storage, "alice", tenantA, foreign.file.id)).rejects.toMatchObject({ status: 404 });
      expect(sign).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled();
    } finally { sign.mockRestore(); upload.mockRestore(); inspect.mockRestore(); }
  });
  it("enforces viewer read-only, uploader confirmation, and tenant-qualified owners/keys", async () => {
    await expect(createUpload(fixture.db, storage, "viewer", tenantA, input)).rejects.toMatchObject({ status: 403 });
    const grant = await createUpload(fixture.db, storage, "member", tenantA, input);
    await expect(confirmUpload(fixture.db, storage, "alice", tenantA, grant.file.id)).rejects.toMatchObject({ status: 403 });
    await expect(createUpload(fixture.db, storage, "", tenantA, input)).rejects.toMatchObject({ status: 401 });
    const id = randomUUID();
    await expect(withTenant(fixture.db, "alice", tenantA, "workspace:read", (tx) => tx.insert(files).values({ ...input, visibility: "private", tenantId: tenantA, ownerId: "bob", id, key: fileKey(tenantA, id) }))).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(withTenant(fixture.db, "alice", tenantA, "workspace:read", (tx) => tx.insert(files).values({ ...input, visibility: "private", tenantId: tenantA, ownerId: "alice", id, key: fileKey(tenantB, id) }))).rejects.toMatchObject({ cause: { code: "23514", constraint: "files_key_scope" } });
  });
});
describe("real S3 adapter against the signed local mock", () => {
  it("pins size, MIME and write-once headers in the signature and rejects tampering/replay", async () => {
    const grant = await createUpload(fixture.db, storage, "alice", tenantA, input);
    const url = new URL(grant.upload.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length;content-type;host;if-none-match");
    expect(grant.upload.expiresIn).toBe(300);
    expect((await fetch(grant.upload.url, { method: "PUT", headers: { ...grant.upload.headers, "Content-Type": "text/html" }, body })).status).toBe(403);
    expect((await fetch(grant.upload.url, { method: "PUT", headers: grant.upload.headers, body: Buffer.from("oversized") })).status).toBe(403);
    const tampered = new URL(grant.upload.url); tampered.searchParams.set("X-Amz-Expires", "999");
    expect((await fetch(tampered, { method: "PUT", headers: grant.upload.headers, body })).status).toBe(403);
    expect((await fetch(grant.upload.url, { method: "PUT", headers: grant.upload.headers, body })).status).toBe(200);
    expect((await fetch(grant.upload.url, { method: "PUT", headers: grant.upload.headers, body })).status).toBe(412);
  });
  it("verifies actual bytes, transitions pending → uploaded → ready, and downloads privately", async () => {
    const grant = await uploaded();
    // Use a second pool for observation: processing holds a transaction on max:1.
    const scanner = { scan: vi.fn(async () => {
      const { rows: [row] } = await fixture.admin.query("select status from files where id = $1", [grant.file.id]);
      expect(row.status).toBe("uploaded"); return "skipped" as const;
    }) };
    const confirmed = await confirmUpload(fixture.db, storage, "alice", tenantA, grant.file.id, scanner);
    expect(confirmed).toMatchObject({ status: "ready", publicUrl: null });
    await confirmUpload(fixture.db, storage, "alice", tenantA, grant.file.id, scanner);
    expect(scanner.scan).toHaveBeenCalledTimes(1);
    const download = await fileDownload(fixture.db, storage, "viewer", tenantA, grant.file.id);
    expect(download.expiresIn).toBe(60);
    const response = await fetch(download.url);
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    await expect(publicDownload(fixture.db, storage, tenantA, grant.file.id)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects incomplete uploads, wrong checksums and infected files", async () => {
    const pending = await createUpload(fixture.db, storage, "alice", tenantA, input);
    await expect(confirmUpload(fixture.db, storage, "alice", tenantA, pending.file.id)).rejects.toMatchObject({ status: 409 });
    await expect(fileDownload(fixture.db, storage, "alice", tenantA, pending.file.id)).rejects.toMatchObject({ status: 409 });
    const wrong = await uploaded("private", "0".repeat(64));
    expect((await confirmUpload(fixture.db, storage, "alice", tenantA, wrong.file.id)).status).toBe("quarantined");
    const infected = await uploaded();
    expect((await confirmUpload(fixture.db, storage, "alice", tenantA, infected.file.id, { async scan() { return "infected"; } })).status).toBe("quarantined");
    await expect(fileDownload(fixture.db, storage, "alice", tenantA, infected.file.id)).rejects.toMatchObject({ status: 409 });
  });
  it("persists uploaded on scan failure and safely retries processing", async () => {
    const grant = await uploaded();
    await expect(confirmUpload(fixture.db, storage, "alice", tenantA, grant.file.id, { async scan() { throw new Error("scanner unavailable"); } })).rejects.toThrow("scanner unavailable");
    expect((await listFiles(fixture.db, "alice", tenantA)).find((file) => file.id === grant.file.id)?.status).toBe("uploaded");
    expect((await confirmUpload(fixture.db, storage, "alice", tenantA, grant.file.id)).status).toBe("ready");
  });
  it("quarantines public uploads without a malware verdict and exposes only clean public files", async () => {
    const skipped = await uploaded("public");
    expect(await confirmUpload(fixture.db, storage, "alice", tenantA, skipped.file.id)).toMatchObject({ status: "quarantined", publicUrl: null });
    await expect(publicDownload(fixture.db, storage, tenantA, skipped.file.id)).rejects.toMatchObject({ status: 404 });
    const clean = await uploaded("public");
    await expect(publicDownload(fixture.db, storage, tenantA, clean.file.id)).rejects.toMatchObject({ status: 404 });
    expect(await confirmUpload(fixture.db, storage, "alice", tenantA, clean.file.id, { async scan() { return "clean"; } })).toMatchObject({ status: "ready", publicUrl: publicFilePath(tenantA, clean.file.id) });
    expect(await fileDownload(fixture.db, storage, "alice", tenantA, clean.file.id)).toEqual({ url: publicFilePath(tenantA, clean.file.id), expiresIn: null });
    expect((await fetch(await publicDownload(fixture.db, storage, tenantA, clean.file.id))).status).toBe(200);
    await expect(publicDownload(fixture.db, storage, tenantB, clean.file.id)).rejects.toMatchObject({ status: 404 });
    expect(await fixture.db.select().from(files)).toEqual([]);
    await withTenant(fixture.db, "bob", tenantB, "workspace:read", async (tx) => {
      expect(await tx.select().from(files).where(eq(files.id, clean.file.id))).toEqual([]);
    });
    await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.public_file_id', ${clean.file.id}, true), set_config('app.public_file_tenant_id', ${tenantA}, true)`);
      expect((await tx.select().from(files)).map((file) => file.id)).toEqual([clean.file.id]);
      expect(await tx.update(files).set({ name: "Forbidden" }).where(eq(files.id, clean.file.id)).returning()).toEqual([]);
      expect(await tx.delete(files).where(eq(files.id, clean.file.id)).returning()).toEqual([]);
    });
    const { rows: [context] } = await fixture.pool.query("select nullif(current_setting('app.public_file_id', true), '') as id, nullif(current_setting('app.public_file_tenant_id', true), '') as tenant");
    expect(context).toEqual({ id: null, tenant: null });
  });
});
