import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "../../src/db/schema";
import { archivePage, createDoc, createFolder, createPage, deleteFolder, deletePage, duplicateDoc, duplicatePage, getDoc, getPage, listDocs, movePage, setDocFavorite, updateDoc, updateFolder, updatePage } from "../../src/server/docs";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "docs-owner", admin = "docs-admin", member = "docs-member", member2 = "docs-member2", viewer = "docs-viewer", other = "docs-other";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, elsewhere: string;
const db = () => fixture.db;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const paragraph = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, admin, member, member2, viewer, other].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, owner, "Docs ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Elsewhere", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'member'),($1,$5,'viewer')", [tenant, admin, member, member2, viewer]);
}, 120_000);
afterAll(async () => { await fixture?.close(); });

describe("folders", () => {
  it("nests folders, keeps names unique per folder (case-insensitive) and caps name length and depth", async () => {
    const a = await createFolder(db(), owner, tenant, { name: "Sermons" });
    const b = await createFolder(db(), owner, tenant, { name: "2026", parentId: a.id });
    expect(await status(createFolder(db(), owner, tenant, { name: "  sermons " }))).toBe(409);
    expect(await status(createFolder(db(), owner, tenant, { name: "SERMONS" }))).toBe(409);
    // The same name below another parent is fine; a blank or over-long name is refused.
    expect(await status(createFolder(db(), owner, tenant, { name: "Sermons", parentId: a.id }))).toBe(200);
    expect(await status(createFolder(db(), owner, tenant, { name: "   " }))).toBe(400);
    expect(await status(createFolder(db(), owner, tenant, { name: "x".repeat(81) }))).toBe(400);
    let parent = b.id; for (let level = 3; level <= 8; level++) parent = (await createFolder(db(), owner, tenant, { name: `L${level}`, parentId: parent })).id;
    expect(await status(createFolder(db(), owner, tenant, { name: "L9", parentId: parent }))).toBe(400);
    // Rename: collision refused, case-only change of its own name allowed.
    const c = await createFolder(db(), owner, tenant, { name: "Notes" });
    expect(await status(updateFolder(db(), owner, tenant, c.id, { name: "sermons" }))).toBe(409);
    expect(await status(updateFolder(db(), owner, tenant, c.id, { name: "NOTES" }))).toBe(200);
  });

  it("refuses a move into the folder's own subtree, in the service and in the database", async () => {
    const top = await createFolder(db(), owner, tenant, { name: "Cycle top" });
    const mid = await createFolder(db(), owner, tenant, { name: "Cycle mid", parentId: top.id });
    const leaf = await createFolder(db(), owner, tenant, { name: "Cycle leaf", parentId: mid.id });
    expect(await status(updateFolder(db(), owner, tenant, top.id, { parentId: leaf.id }))).toBe(409);
    expect(await status(updateFolder(db(), owner, tenant, top.id, { parentId: top.id }))).toBe(409);
    expect(await status(updateFolder(db(), owner, tenant, leaf.id, { parentId: null }))).toBe(200);
    // The trigger stands alone: even a direct write cannot close a loop.
    await expect(fixture.admin.query("update doc_folders set parent_id=$1 where id=$2", [leaf.id, top.id])).resolves.toBeDefined();
    await fixture.admin.query("update doc_folders set parent_id=null where id=$1", [top.id]);
    await expect(fixture.admin.query("update doc_folders set parent_id=$1 where id=$2", [mid.id, top.id])).rejects.toMatchObject({ code: "23514" });
  });

  it("never deletes a non-empty folder silently: refuse with counts, or move the contents up one level", async () => {
    const parent = await createFolder(db(), owner, tenant, { name: "Del parent" });
    const folder = await createFolder(db(), owner, tenant, { name: "Del me", parentId: parent.id });
    const sub = await createFolder(db(), owner, tenant, { name: "Del sub", parentId: folder.id });
    const doc = await createDoc(db(), owner, tenant, { title: "Inside", folderId: folder.id });
    const error = await deleteFolder(db(), owner, tenant, folder.id, { mode: "refuse" }).catch((e: { status: number; details: unknown }) => e);
    expect(error).toMatchObject({ status: 409, details: { folders: 1, docs: 1 } });
    expect(await status(deleteFolder(db(), owner, tenant, folder.id, undefined))).toBe(409);
    expect(await deleteFolder(db(), owner, tenant, folder.id, { mode: "move_to_parent" })).toMatchObject({ movedDocs: 1, movedFolders: 1 });
    const list = await listDocs(db(), owner, tenant, { folderId: parent.id });
    expect(list.docs.map((d) => d.id)).toEqual([doc.id]);
    expect(list.folders.find((f) => f.id === sub.id)?.parentId).toBe(parent.id);
    expect(list.folders.some((f) => f.id === folder.id)).toBe(false);
    // An empty folder deletes with the default mode; an archived or trashed doc still counts as contents.
    const empty = await createFolder(db(), owner, tenant, { name: "Empty one" });
    expect(await status(deleteFolder(db(), owner, tenant, empty.id, {}))).toBe(200);
    const holder = await createFolder(db(), owner, tenant, { name: "Holds trash" });
    const trashed = await createDoc(db(), owner, tenant, { title: "Trashed inside", folderId: holder.id });
    await updateDoc(db(), owner, tenant, trashed.id, { trashed: true });
    expect(await status(deleteFolder(db(), owner, tenant, holder.id, { mode: "refuse" }))).toBe(409);
  });

  it("applies the same role rules as docs: viewers cannot write, members change only their own folders", async () => {
    expect(await status(createFolder(db(), viewer, tenant, { name: "Viewer folder" }))).toBe(403);
    const mine = await createFolder(db(), member, tenant, { name: "Member folder" });
    expect(await status(updateFolder(db(), member2, tenant, mine.id, { name: "Hijacked" }))).toBe(403);
    expect(await status(updateFolder(db(), admin, tenant, mine.id, { name: "Admin renamed" }))).toBe(200);
    expect(await status(deleteFolder(db(), member2, tenant, mine.id, {}))).toBe(403);
    expect(await status(deleteFolder(db(), member, tenant, mine.id, {}))).toBe(200);
  });

  it("isolates ministries", async () => {
    const f = await createFolder(db(), owner, tenant, { name: "Private to ministry" });
    expect(await status(updateFolder(db(), other, elsewhere, f.id, { name: "x" }))).toBe(404);
    expect(await status(createFolder(db(), other, elsewhere, { name: "y", parentId: f.id }))).toBe(400);
    expect((await listDocs(db(), other, elsewhere, {})).folders).toEqual([]);
    expect(await status(listDocs(db(), other, tenant, {}))).toBe(403);
    // The composite foreign key stops a doc from pointing at another ministry's folder even when written directly.
    await expect(fixture.admin.query("insert into docs(tenant_id,folder_id,title,owner_id) values($1,$2,'x',$3)", [elsewhere, f.id, other])).rejects.toMatchObject({ code: "23503" });
  });
});

describe("docs", () => {
  it("creates a doc with its first page, lists by folder, and searches across folders with the folder visible", async () => {
    const folder = await createFolder(db(), owner, tenant, { name: "Search folder" });
    const inFolder = await createDoc(db(), owner, tenant, { title: "Zebra plan", folderId: folder.id });
    const atTop = await createDoc(db(), owner, tenant, { title: "Zebra budget" });
    const detail = await getDoc(db(), owner, tenant, inFolder.id);
    expect(detail.pages).toHaveLength(1);
    expect(detail.pages[0]).toMatchObject({ parentId: null, position: 0, title: "Zebra plan" });
    expect((await listDocs(db(), owner, tenant, { folderId: folder.id })).docs.map((d) => d.id)).toEqual([inFolder.id]);
    expect((await listDocs(db(), owner, tenant, {})).docs.map((d) => d.id)).toContain(atTop.id);
    expect((await listDocs(db(), owner, tenant, {})).docs.map((d) => d.id)).not.toContain(inFolder.id);
    const found = await listDocs(db(), owner, tenant, { q: "zebra" });
    expect(found.docs.map((d) => d.id).sort()).toEqual([inFolder.id, atTop.id].sort());
    expect(found.docs.find((d) => d.id === inFolder.id)?.folderId).toBe(folder.id);
    // Wildcards in the query are literal.
    expect((await listDocs(db(), owner, tenant, { q: "%" })).docs).toEqual([]);
    // A page title matches too.
    await createPage(db(), owner, tenant, atTop.id, { title: "Quokka appendix" });
    expect((await listDocs(db(), owner, tenant, { q: "quokka" })).docs.map((d) => d.id)).toEqual([atTop.id]);
  });

  it("archives, trashes and restores; favourites are private to each person", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Lifecycle" });
    await updateDoc(db(), member, tenant, d.id, { archived: true });
    expect((await listDocs(db(), member, tenant, { status: "archived" })).docs.map((x) => x.id)).toContain(d.id);
    expect((await listDocs(db(), member, tenant, {})).docs.map((x) => x.id)).not.toContain(d.id);
    await updateDoc(db(), member, tenant, d.id, { archived: false, trashed: true });
    expect((await listDocs(db(), member, tenant, { status: "trash" })).docs.map((x) => x.id)).toContain(d.id);
    expect(await status(getDoc(db(), member, tenant, d.id))).toBe(404);
    await updateDoc(db(), member, tenant, d.id, { trashed: false });
    expect(await status(getDoc(db(), member, tenant, d.id))).toBe(200);
    await setDocFavorite(db(), member, tenant, d.id, true);
    expect((await getDoc(db(), member, tenant, d.id)).doc.favorite).toBe(true);
    expect((await getDoc(db(), owner, tenant, d.id)).doc.favorite).toBe(false);
    expect((await listDocs(db(), member, tenant, { favorites: "1" })).docs.map((x) => x.id)).toEqual([d.id]);
    expect((await listDocs(db(), viewer, tenant, { favorites: "1" })).docs).toEqual([]);
    await setDocFavorite(db(), viewer, tenant, d.id, true);
    await setDocFavorite(db(), member, tenant, d.id, false);
    expect((await getDoc(db(), viewer, tenant, d.id)).doc.favorite).toBe(true);
  });

  it("members edit docs they own, owners and admins manage all, viewers read", async () => {
    const mine = await createDoc(db(), member, tenant, { title: "Member doc" });
    const theirs = await createDoc(db(), owner, tenant, { title: "Owner doc" });
    expect(await status(createDoc(db(), viewer, tenant, { title: "No" }))).toBe(403);
    expect(await status(updateDoc(db(), member, tenant, mine.id, { title: "Mine renamed" }))).toBe(200);
    expect(await status(updateDoc(db(), member, tenant, theirs.id, { title: "Not mine" }))).toBe(403);
    expect(await status(updateDoc(db(), member2, tenant, mine.id, { title: "Not theirs" }))).toBe(403);
    expect(await status(updateDoc(db(), viewer, tenant, mine.id, { title: "Viewer" }))).toBe(403);
    expect(await status(updateDoc(db(), admin, tenant, mine.id, { title: "Admin renamed" }))).toBe(200);
    expect(await status(updateDoc(db(), owner, tenant, mine.id, { archived: true }))).toBe(200);
    const read = await getDoc(db(), viewer, tenant, theirs.id);
    expect(read.rights).toEqual({ manage: false, write: false });
    expect((await getDoc(db(), member, tenant, mine.id)).rights.write).toBe(true);
    // Anyone who can read may duplicate: the copy is theirs.
    const copy = await duplicateDoc(db(), member2, tenant, theirs.id);
    expect((await getDoc(db(), member2, tenant, copy.id)).doc.ownerId).toBe(member2);
    expect(await status(duplicateDoc(db(), viewer, tenant, theirs.id))).toBe(403);
  });

  it("enforces the owner rule in the database itself, not only in the service", async () => {
    const theirs = await createDoc(db(), owner, tenant, { title: "Guarded by policy" });
    const page = (await getDoc(db(), owner, tenant, theirs.id)).pages[0];
    // A member's direct update of another person's doc or page changes no row (row-level security).
    const changed = await withTenant(db(), member, tenant, "docs:read", async (tx) => {
      const a = await tx.execute(sql`update docs set title='hacked' where id=${theirs.id} returning id`);
      const b = await tx.execute(sql`update doc_pages set title='hacked' where id=${page.id} returning id`);
      const c = await tx.execute(sql`delete from doc_pages where id=${page.id} returning id`);
      return [a.rows.length, b.rows.length, c.rows.length];
    });
    expect(changed).toEqual([0, 0, 0]);
    // A viewer cannot insert even directly.
    await expect(withTenant(db(), viewer, tenant, "docs:read", (tx) => tx.execute(sql`insert into docs(tenant_id,title,owner_id) values(${tenant},'x',${viewer})`))).rejects.toMatchObject({ cause: { code: "42501" } });
    expect((await getDoc(db(), owner, tenant, theirs.id)).doc.title).toBe("Guarded by policy");
  });

  it("stores a kind per doc and the engine and schema version per page, and shows folder counts", async () => {
    const folder = await createFolder(db(), owner, tenant, { name: "Counted" });
    const d = await createDoc(db(), owner, tenant, { title: "Kind check", folderId: folder.id });
    const listed = (await listDocs(db(), owner, tenant, { folderId: folder.id })).docs[0];
    expect(listed.kind).toBe("document");
    expect((await getPage(db(), owner, tenant, d.id, (await getDoc(db(), owner, tenant, d.id)).pages[0].id))).toMatchObject({ engine: "tiptap", schemaVersion: 1 });
    expect((await listDocs(db(), owner, tenant, {})).folders.find((f) => f.id === folder.id)).toMatchObject({ docCount: 1, docTotal: 1 });
    await expect(fixture.admin.query("update docs set kind='slides' where id=$1", [d.id])).rejects.toMatchObject({ code: "23514" });
    await expect(fixture.admin.query("update doc_pages set engine='other' where doc_id=$1", [d.id])).rejects.toMatchObject({ code: "23514" });
    await fixture.admin.query("update docs set kind='spreadsheet' where id=$1", [d.id]);
    expect((await duplicateDoc(db(), owner, tenant, d.id).then((c) => listDocs(db(), owner, tenant, { q: "Kind check (copy)" }))).docs[0].kind).toBe("spreadsheet");
  });

  it("has no foreign key to contacts, so erasing or merging a person cannot touch Docs", async () => {
    const { rows } = await fixture.admin.query(`select conrelid::regclass::text as t, confrelid::regclass::text as f from pg_constraint where contype='f' and conrelid::regclass::text in ('docs','doc_pages','doc_folders','doc_favorites')`);
    expect(rows.map((r) => r.f)).not.toContain("contacts");
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("pages", () => {
  const tree = async (docId: string) => (await getDoc(db(), owner, tenant, docId)).pages;
  const title = (pages: Awaited<ReturnType<typeof tree>>, id: string) => pages.find((p) => p.id === id)?.title;

  it("keeps an ordered tree: add, reorder densely, nest, un-nest, and refuse cycles and excess depth", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Tree" });
    const first = (await tree(d.id))[0].id;
    const b = (await createPage(db(), owner, tenant, d.id, { title: "B" })).id, c = (await createPage(db(), owner, tenant, d.id, { title: "C" })).id;
    expect((await tree(d.id)).map((p) => [p.title, p.position])).toEqual([["Tree", 0], ["B", 1], ["C", 2]]);
    await movePage(db(), owner, tenant, d.id, c, { parentId: null, index: 0 });
    expect((await tree(d.id)).sort((x, y) => x.position - y.position).map((p) => p.title)).toEqual(["C", "Tree", "B"]);
    // Nest B under C (a subpage), then move C under B: that would be a cycle.
    await movePage(db(), owner, tenant, d.id, b, { parentId: c, index: 0 });
    let pages = await tree(d.id);
    expect(pages.find((p) => p.id === b)).toMatchObject({ parentId: c, position: 0 });
    expect(pages.filter((p) => p.parentId === null).sort((x, y) => x.position - y.position).map((p) => [p.title, p.position])).toEqual([["C", 0], ["Tree", 1]]);
    expect(await status(movePage(db(), owner, tenant, d.id, c, { parentId: b, index: 0 }))).toBe(409);
    expect(await status(movePage(db(), owner, tenant, d.id, c, { parentId: c, index: 0 }))).toBe(409);
    await expect(fixture.admin.query("update doc_pages set parent_id=$1 where id=$2", [b, c])).rejects.toMatchObject({ code: "23514" });
    // Out again.
    await movePage(db(), owner, tenant, d.id, b, { parentId: null, index: 99 });
    pages = await tree(d.id);
    expect(pages.filter((p) => p.parentId === null).sort((x, y) => x.position - y.position).map((p) => p.title)).toEqual(["C", "Tree", "B"]);
    // A page of another doc is not a valid parent.
    const other2 = await createDoc(db(), owner, tenant, { title: "Other doc" });
    expect(await status(movePage(db(), owner, tenant, d.id, b, { parentId: (await tree(other2.id))[0].id, index: 0 }))).toBe(404);
    // Depth: the sixth level is the last.
    let parent = first;
    for (let level = 2; level <= 6; level++) parent = (await createPage(db(), owner, tenant, d.id, { parentId: parent, title: `D${level}` })).id;
    expect(await status(createPage(db(), owner, tenant, d.id, { parentId: parent, title: "D7" }))).toBe(400);
  });

  it("archives and restores a subtree, deletes a subtree, and always keeps one top-level page", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Lifecycle pages" });
    const root = (await tree(d.id))[0].id;
    const parent = (await createPage(db(), owner, tenant, d.id, { title: "Parent" })).id;
    const kid = (await createPage(db(), owner, tenant, d.id, { parentId: parent, title: "Kid" })).id;
    expect(await archivePage(db(), owner, tenant, d.id, parent, true)).toEqual({ pages: 2 });
    expect((await tree(d.id)).filter((p) => p.archivedAt).map((p) => p.id).sort()).toEqual([parent, kid].sort());
    await archivePage(db(), owner, tenant, d.id, parent, false);
    expect((await tree(d.id)).some((p) => p.archivedAt)).toBe(false);
    expect(await status(archivePage(db(), owner, tenant, d.id, root, true))).toBe(200);
    expect(await status(archivePage(db(), owner, tenant, d.id, parent, true))).toBe(400);
    await archivePage(db(), owner, tenant, d.id, root, false);
    expect(await deletePage(db(), owner, tenant, d.id, parent)).toEqual({ pages: 2 });
    expect((await tree(d.id)).map((p) => p.id)).toEqual([root]);
    expect(await status(deletePage(db(), owner, tenant, d.id, root))).toBe(400);
  });

  it("duplicates a page with its subpages and a doc with all its pages", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Dup source" });
    const p = (await createPage(db(), owner, tenant, d.id, { title: "P" })).id;
    await createPage(db(), owner, tenant, d.id, { parentId: p, title: "P kid" });
    const copied = await duplicatePage(db(), owner, tenant, d.id, p);
    const pages = await tree(d.id);
    expect(pages).toHaveLength(5);
    expect(pages.filter((x) => x.parentId === copied.id).map((x) => x.title)).toEqual(["P kid"]);
    const top = pages.filter((x) => x.parentId === null).sort((a, b) => a.position - b.position);
    expect(top.map((x) => x.position)).toEqual([0, 1, 2]);
    expect(top[2].id).toBe(copied.id);
    const doc2 = await duplicateDoc(db(), owner, tenant, d.id);
    const clone = (await getDoc(db(), owner, tenant, doc2.id)).pages;
    expect(clone).toHaveLength(5);
    expect(clone.every((x) => !pages.some((y) => y.id === x.id))).toBe(true);
  });

  it("checks the version on autosave: a stale save is refused and changes nothing", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Versions" });
    const id = (await tree(d.id))[0].id;
    const loaded = await getPage(db(), owner, tenant, d.id, id);
    const saved = await updatePage(db(), owner, tenant, d.id, id, { version: loaded.version, content: paragraph("first") });
    expect(saved.version).toBe(loaded.version + 1);
    const stale = await updatePage(db(), admin, tenant, d.id, id, { version: loaded.version, content: paragraph("stale") }).catch((e: { status: number; details?: { reason: string } }) => e);
    expect(stale).toMatchObject({ status: 409, details: { reason: "stale" } });
    expect(JSON.stringify((await getPage(db(), owner, tenant, d.id, id)).content)).toContain("first");
    await updatePage(db(), admin, tenant, d.id, id, { version: saved.version, content: paragraph("second") });
    expect(JSON.stringify((await getPage(db(), owner, tenant, d.id, id)).content)).toContain("second");
  });

  it("names the doc after its first top-level page and stores page styles", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Old name" });
    const [first] = await tree(d.id);
    const second = (await createPage(db(), owner, tenant, d.id, { title: "Second" })).id;
    await updatePage(db(), owner, tenant, d.id, first.id, { version: 1, title: "New name", style: { font: "serif", width: "wide", header: { owner: false }, sections: { outline: true } } });
    expect((await getDoc(db(), owner, tenant, d.id)).doc.title).toBe("New name");
    const p2 = await getPage(db(), owner, tenant, d.id, second);
    await updatePage(db(), owner, tenant, d.id, second, { version: p2.version, title: "Second renamed" });
    expect((await getDoc(db(), owner, tenant, d.id)).doc.title).toBe("New name");
    expect((await getPage(db(), owner, tenant, d.id, first.id)).style).toEqual({ font: "serif", width: "wide", header: { owner: false }, sections: { outline: true } });
    expect(await status(updatePage(db(), owner, tenant, d.id, first.id, { version: 2, style: { font: "comic" } }))).toBe(400);
    expect(await status(updatePage(db(), owner, tenant, d.id, first.id, { version: 2, title: "x".repeat(201) }))).toBe(400);
  });

  it("protects a page: read-only for everyone until it is unprotected; viewers and strangers cannot change it", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Protect" });
    const id = (await tree(d.id))[0].id;
    await updatePage(db(), member, tenant, d.id, id, { version: 1, protected: true });
    const refused = await updatePage(db(), member, tenant, d.id, id, { version: 2, content: paragraph("nope") }).catch((e: { status: number; details?: { reason: string } }) => e);
    expect(refused).toMatchObject({ status: 409, details: { reason: "protected" } });
    expect(await status(updatePage(db(), admin, tenant, d.id, id, { version: 2, title: "nope" }))).toBe(409);
    expect(await status(movePage(db(), member, tenant, d.id, id, { parentId: null, index: 0 }))).toBe(409);
    expect(await status(deletePage(db(), member, tenant, d.id, id))).toBe(409);
    expect(await status(updatePage(db(), viewer, tenant, d.id, id, { version: 2, protected: false }))).toBe(403);
    expect(await status(updatePage(db(), member2, tenant, d.id, id, { version: 2, protected: false }))).toBe(403);
    await updatePage(db(), admin, tenant, d.id, id, { version: 2, protected: false });
    expect(await status(updatePage(db(), member, tenant, d.id, id, { version: 3, content: paragraph("ok") }))).toBe(200);
  });

  it("sanitises content: only known nodes and marks, https links only, hex colours, size caps", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Sanitise" });
    const id = (await tree(d.id))[0].id;
    let version = 1;
    const save = async (content: unknown) => { const r = await updatePage(db(), owner, tenant, d.id, id, { version, content }); version = r.version; return (await getPage(db(), owner, tenant, d.id, id)).content; };
    const link = (href: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href, target: "_blank", onclick: "x()" } }] }] }] });
    const kept = await save(link("https://example.org/a?b=1"));
    expect(JSON.stringify(kept)).toContain('"href":"https://example.org/a?b=1"');
    expect(JSON.stringify(kept)).not.toContain("onclick");
    expect(JSON.stringify(kept)).not.toContain("target");
    for (const bad of ["javascript:alert(1)", "http://example.org", "data:text/html;base64,AA==", "https://user:pw@example.org", "//example.org", "mailto:a@b.c"]) {
      const out = JSON.stringify(await save(link(bad)));
      expect(out).toContain('"text":"go"');
      expect(out).not.toContain('"type":"link"');
    }
    // Unknown node and mark types are refused outright, nothing is stored.
    for (const doc of [
      { type: "doc", content: [{ type: "script", content: [{ type: "text", text: "alert(1)" }] }] },
      { type: "doc", content: [{ type: "image", attrs: { src: "https://example.org/x.png" } }] },
      { type: "doc", content: [{ type: "iframe", attrs: { src: "https://example.org" } }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "fontSize" }] }] }] },
      { type: "paragraph" }, "text", null, { type: "doc", content: "no" },
    ]) expect(await status(updatePage(db(), owner, tenant, d.id, id, { version, content: doc }))).toBe(400);
    // Colours: valid hex kept, anything else dropped (no style injection); attributes outside the list vanish.
    const styled = JSON.stringify(await save({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center", style: "x", class: "y" }, content: [
      { type: "text", text: "a", marks: [{ type: "textStyle", attrs: { color: "#DC2626" } }] },
      { type: "text", text: "b", marks: [{ type: "textStyle", attrs: { color: "red; background:url(x)" } }] },
      { type: "text", text: "c", marks: [{ type: "highlight", attrs: { color: "#fef08a" } }, { type: "bold" }] }] }] }));
    expect(styled).toContain('"color":"#dc2626"');
    expect(styled).toContain('"color":"#fef08a"');
    expect(styled).toContain('"textAlign":"center"');
    expect(styled).not.toContain("url(");
    expect(styled).not.toContain('"style"');
    expect(styled).not.toContain('"class"');
    // Supported blocks pass through.
    const blocks = JSON.stringify(await save({ type: "doc", content: [
      { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "h" }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] }] },
      { type: "callout", attrs: { tone: "warning" }, content: [{ type: "paragraph" }] }, { type: "columns", content: [{ type: "column", content: [{ type: "paragraph" }] }, { type: "column", content: [{ type: "paragraph" }] }] },
      { type: "details", attrs: { open: true }, content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [{ type: "paragraph" }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph" }] }] }] },
      { type: "tableOfContents" }, { type: "horizontalRule" }, { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "1" }] }] }));
    for (const expected of ["taskItem", "callout", "columns", "details", "tableHeader", "tableOfContents", "codeBlock", '"level":4']) expect(blocks).toContain(expected);
    // Size and depth caps.
    expect(await status(updatePage(db(), owner, tenant, d.id, id, { version, content: paragraph("x".repeat(600_000)) }))).toBe(400);
    let deep: unknown = { type: "paragraph" }; for (let i = 0; i < 30; i++) deep = { type: "blockquote", content: [deep] };
    expect(await status(updatePage(db(), owner, tenant, d.id, id, { version, content: { type: "doc", content: [deep] } }))).toBe(400);
    expect(await status(updatePage(db(), owner, tenant, d.id, id, { version, content: paragraph("x".repeat(20_001)) }))).toBe(400);
  });

  it("isolates pages between ministries and between docs", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Isolated" });
    const id = (await tree(d.id))[0].id;
    expect(await status(getPage(db(), other, elsewhere, d.id, id))).toBe(404);
    expect(await status(getPage(db(), other, tenant, d.id, id))).toBe(403);
    expect(await status(createPage(db(), other, elsewhere, d.id, {}))).toBe(404);
    const d2 = await createDoc(db(), owner, tenant, { title: "Isolated 2" });
    expect(await status(getPage(db(), owner, tenant, d2.id, id))).toBe(404);
  });

  it("writes audit rows without content", async () => {
    const { rows } = await fixture.admin.query("select action, metadata, target_id from audit_logs where tenant_id=$1 and action like 'docs.%'", [tenant]);
    expect(rows.length).toBeGreaterThan(10);
    expect(new Set(rows.map((r) => r.action))).toEqual(expect.objectContaining({}));
    expect(JSON.stringify(rows)).not.toContain("first");
    expect(JSON.stringify(rows)).not.toContain("example.org");
    expect(rows.some((r) => r.action === "docs.page.protect")).toBe(true);
  });
});
