import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { crmTasks, users } from "../../src/db/schema";
import { createContact, eraseContact } from "../../src/server/contacts";
import { createDoc, createPage, getDoc, getPage, listDocs, updateDoc, updatePage } from "../../src/server/docs";
import { createComment, deleteComment, listThreads, updateThread } from "../../src/server/docs-comments";
import { attachFile, detachFile, exportDoc, importAsNewDoc, importIntoDoc, listAttachments, printableDoc } from "../../src/server/docs-io";
import { addLink, listLinks, removeLink, searchTargets } from "../../src/server/docs-links";
import { listNotifications, markNotificationsRead } from "../../src/server/docs-notify";
import { getSharing, readPublicDoc, removeShare, setAccess, setPublicLink, setShare } from "../../src/server/docs-sharing";
import { applyTemplate, deleteTemplate, listTemplates, saveTemplate, updateTemplate } from "../../src/server/docs-templates";
import { getVersion, listVersions, restoreVersion } from "../../src/server/docs-history";
import { withTenant } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "dc-owner", admin = "dc-admin", member = "dc-member", member2 = "dc-member2", viewer = "dc-viewer", other = "dc-other";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, elsewhere: string;
const db = () => fixture.db;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const firstPage = async (docId: string, as = owner) => (await getDoc(db(), as, tenant, docId)).pages[0].id;

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, admin, member, member2, viewer, other].map((id) => ({ id, name: id.replace("dc-", "Name "), email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, owner, "Collab ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Elsewhere", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'member'),($1,$5,'viewer')", [tenant, admin, member, member2, viewer]);
}, 120_000);
afterAll(async () => { await fixture?.close(); });

describe("privacy and sharing", () => {
  it("makes new docs private: other members cannot see them, owners and admins can", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Private notes" });
    expect(await status(getDoc(db(), member2, tenant, d.id))).toBe(404);
    expect(await status(getDoc(db(), viewer, tenant, d.id))).toBe(404);
    expect((await listDocs(db(), member2, tenant, {})).docs.some((x) => x.id === d.id)).toBe(false);
    expect((await listDocs(db(), member2, tenant, { q: "Private notes" })).docs).toEqual([]);
    // Leadership oversight: owners and admins read and manage every doc.
    expect((await getDoc(db(), owner, tenant, d.id)).rights).toMatchObject({ manage: true, write: true });
    expect((await getDoc(db(), admin, tenant, d.id)).rights.manage).toBe(true);
    expect(await status(getPage(db(), member2, tenant, d.id, await firstPage(d.id, member)))).toBe(404);
  });

  it("shares with a person at view, comment or edit, and lets the owner change or remove it", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Shared with Name member2" });
    const page = await firstPage(d.id, member);
    await setShare(db(), member, tenant, d.id, { userId: member2, role: "view" });
    expect((await getDoc(db(), member2, tenant, d.id)).rights).toEqual({ manage: false, write: false, comment: false, read: true });
    expect(await status(updatePage(db(), member2, tenant, d.id, page, { version: 1, title: "x" }))).toBe(403);
    expect(await status(createComment(db(), member2, tenant, d.id, page, { body: "hi" }))).toBe(403);
    await setShare(db(), member, tenant, d.id, { userId: member2, role: "comment" });
    expect(await status(createComment(db(), member2, tenant, d.id, page, { body: "hi" }))).toBe(200);
    expect(await status(updatePage(db(), member2, tenant, d.id, page, { version: 1, title: "x" }))).toBe(403);
    await setShare(db(), member, tenant, d.id, { userId: member2, role: "edit" });
    expect(await status(updatePage(db(), member2, tenant, d.id, page, { version: 1, title: "Edited by sharee" }))).toBe(200);
    // An editor still cannot change who has access, trash or move the doc.
    expect(await status(setShare(db(), member2, tenant, d.id, { userId: viewer, role: "view" }))).toBe(403);
    expect(await status(setAccess(db(), member2, tenant, d.id, { visibility: "ministry" }))).toBe(403);
    expect(await status(updateDoc(db(), member2, tenant, d.id, { trashed: true }))).toBe(403);
    // The sharing view: the owner sees everyone, a sharee only themselves.
    const asOwner = await getSharing(db(), member, tenant, d.id), asSharee = await getSharing(db(), member2, tenant, d.id);
    expect(asOwner.shares.map((s) => s.userId)).toEqual([member2]);
    expect(asOwner.people.map((p) => p.userId).sort()).toEqual([admin, owner, viewer].sort());
    expect(asSharee).toMatchObject({ canManage: false, people: [] });
    await removeShare(db(), member, tenant, d.id, member2);
    expect(await status(getDoc(db(), member2, tenant, d.id))).toBe(404);
    // Only ministry members can be given access; the owner already has it.
    expect(await status(setShare(db(), member, tenant, d.id, { userId: other, role: "view" }))).toBe(400);
    expect(await status(setShare(db(), member, tenant, d.id, { userId: member, role: "view" }))).toBe(400);
  });

  it("caps a ministry viewer at comment and keeps ministry-wide access separate from sharing", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "For the ministry" });
    const page = await firstPage(d.id);
    await setAccess(db(), owner, tenant, d.id, { visibility: "ministry", ministryAccess: "edit" });
    expect((await getDoc(db(), member2, tenant, d.id)).rights.write).toBe(true);
    expect((await getDoc(db(), viewer, tenant, d.id)).rights).toMatchObject({ write: false, comment: true });
    expect(await status(updatePage(db(), viewer, tenant, d.id, page, { version: 1, title: "no" }))).toBe(403);
    expect(await status(updatePage(db(), member2, tenant, d.id, page, { version: 1, title: "yes" }))).toBe(200);
    await setAccess(db(), owner, tenant, d.id, { visibility: "private" });
    expect(await status(getDoc(db(), member2, tenant, d.id))).toBe(404);
  });

  it("enforces the sharing rules in the database too", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Guarded sharing" });
    await setShare(db(), owner, tenant, d.id, { userId: member, role: "edit" });
    const attempts = await withTenant(db(), member, tenant, "docs:read", async (tx) => {
      const rows = await tx.execute(sql`update docs set title='ok title' where id=${d.id} returning id`);
      let guard = "none";
      await tx.execute(sql`savepoint s1`);
      try { await tx.execute(sql`update docs set visibility='ministry' where id=${d.id}`); } catch (e) { guard = (e as { cause?: { code?: string } }).cause?.code ?? "err"; await tx.execute(sql`rollback to savepoint s1`); }
      const ins = await tx.execute(sql`select count(*)::int n from doc_shares where doc_id=${d.id}`);
      return { updated: rows.rows.length, guard, shares: ins.rows[0].n };
    });
    expect(attempts).toEqual({ updated: 1, guard: "42501", shares: 1 });
    // A stranger from another ministry sees nothing and cannot write a share.
    await expect(fixture.admin.query("insert into doc_shares(tenant_id,doc_id,owner_id,user_id,role,created_by) values($1,$2,$4,$3,'view',$3)", [elsewhere, d.id, other, owner])).rejects.toMatchObject({ code: "23503" });
    expect(await status(getSharing(db(), other, elsewhere, d.id))).toBe(404);
  });

  it("keeps the public link off unless the gate and an explicit approval are both present, and never reads without a matching token", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Public candidate" });
    expect(await status(setPublicLink(db(), owner, tenant, d.id, { enabled: true, approved: true }))).toBe(403);
    expect(await status(setPublicLink(db(), owner, tenant, d.id, { enabled: true }))).toBe(403);
    process.env.HARVEST_DOCS_PUBLIC = "synthetic";
    try {
      expect(await status(setPublicLink(db(), owner, tenant, d.id, { enabled: true }))).toBe(403);
      expect(await status(setPublicLink(db(), member2, tenant, d.id, { enabled: true, approved: true }))).toBe(404);
      const { token } = await setPublicLink(db(), owner, tenant, d.id, { enabled: true, approved: true });
      expect(token).toHaveLength(43);
      const stored = await fixture.admin.query("select public_enabled, public_token_hash from docs where id=$1", [d.id]);
      expect(stored.rows[0].public_enabled).toBe(true);
      expect(stored.rows[0].public_token_hash).not.toContain(token!);
      expect((await readPublicDoc(db(), token!)).title).toBe("Public candidate");
      expect(await status(readPublicDoc(db(), "A".repeat(43)))).toBe(404);
      await setPublicLink(db(), owner, tenant, d.id, { enabled: false });
      expect(await status(readPublicDoc(db(), token!))).toBe(404);
    } finally { delete process.env.HARVEST_DOCS_PUBLIC; }
    expect(await status(readPublicDoc(db(), "A".repeat(43)))).toBe(404);
  });
});

describe("comments and notifications", () => {
  it("threads on the page or on quoted text, replies, resolves, assigns and notifies in the app only", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Comment target" });
    const page = await firstPage(d.id);
    await setAccess(db(), owner, tenant, d.id, { visibility: "ministry", ministryAccess: "comment" });
    const t1 = await createComment(db(), member, tenant, d.id, page, { body: "Please check this", quote: "the first line", mentions: [member2, other], assigneeId: member2 });
    const t2 = await createComment(db(), viewer, tenant, d.id, page, { body: "A page comment" });
    await createComment(db(), member2, tenant, d.id, page, { body: "On it", parentId: t1.id });
    let list = await listThreads(db(), owner, tenant, d.id, page);
    expect(list.threads).toHaveLength(2);
    const first = list.threads.find((t) => t.id === t1.id)!;
    expect(first).toMatchObject({ quote: "the first line", status: "open", assigneeId: member2, replies: [expect.objectContaining({ body: "On it" })] });
    expect(first.mentions).toEqual([member2]);
    // Notifications: the mentioned and assigned person (once each), the thread author on reply; never the actor, never a non-member.
    const n2 = await listNotifications(db(), member2, tenant);
    expect(n2.items.map((i) => i.kind).sort()).toEqual(["assigned", "mention"]);
    expect(n2.unread).toBe(2);
    expect((await listNotifications(db(), member, tenant)).items.filter((i) => i.docId === d.id).map((i) => i.kind)).toEqual(["reply"]);
    expect((await listNotifications(db(), viewer, tenant)).items).toEqual([]);
    await markNotificationsRead(db(), member2, tenant, { ids: "all" });
    expect((await listNotifications(db(), member2, tenant)).unread).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from doc_notifications where user_id=$1", [other])).rows[0].n).toBe(0);
    // Resolve, reopen, reassign.
    expect(await status(updateThread(db(), viewer, tenant, d.id, t2.id, { status: "resolved" }))).toBe(200);
    list = await listThreads(db(), owner, tenant, d.id, page);
    expect(list.threads.find((t) => t.id === t2.id)).toMatchObject({ status: "resolved", resolvedByName: "Name viewer" });
    await updateThread(db(), owner, tenant, d.id, t2.id, { status: "open", assigneeId: admin });
    expect((await listThreads(db(), owner, tenant, d.id, page)).threads.find((t) => t.id === t2.id)).toMatchObject({ status: "open", assigneeId: admin, resolvedAt: null });
    expect((await listNotifications(db(), admin, tenant)).items.map((i) => i.kind)).toEqual(["assigned"]);
  });

  it("lets only the author edit text, the author or a manager delete, and a reader of a viewer-only share not comment", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Comment rules" });
    const page = await firstPage(d.id);
    await setAccess(db(), owner, tenant, d.id, { visibility: "ministry", ministryAccess: "comment" });
    const c = await createComment(db(), member, tenant, d.id, page, { body: "mine" });
    expect(await status(updateThread(db(), member2, tenant, d.id, c.id, { body: "hijack" }))).toBe(403);
    expect(await status(updateThread(db(), member, tenant, d.id, c.id, { body: "edited" }))).toBe(200);
    // The database refuses an edit of someone else's text even if the service were bypassed.
    const raw = await withTenant(db(), member2, tenant, "docs:read", async (tx) => { await tx.execute(sql`savepoint s`); try { await tx.execute(sql`update doc_comments set body='x' where id=${c.id}`); return "changed"; } catch (e) { await tx.execute(sql`rollback to savepoint s`); return (e as { cause?: { code?: string } }).cause?.code; } });
    expect(raw).toBe("42501");
    expect(await status(deleteComment(db(), member2, tenant, d.id, c.id))).toBe(403);
    expect(await status(deleteComment(db(), admin, tenant, d.id, c.id))).toBe(200);
    await setAccess(db(), owner, tenant, d.id, { visibility: "ministry", ministryAccess: "view" });
    expect(await status(createComment(db(), member2, tenant, d.id, page, { body: "no" }))).toBe(403);
    expect(await status(createComment(db(), member2, tenant, d.id, page, { body: "   " }))).toBe(400);
    expect(await status(createComment(db(), owner, tenant, d.id, page, { body: "x".repeat(2001) }))).toBe(400);
  });

  it("hides notifications about a doc the person can no longer open", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Revoked" });
    await setShare(db(), owner, tenant, d.id, { userId: member2, role: "view" });
    expect((await listNotifications(db(), member2, tenant)).items.some((i) => i.docId === d.id)).toBe(true);
    await removeShare(db(), owner, tenant, d.id, member2);
    expect((await listNotifications(db(), member2, tenant)).items.some((i) => i.docId === d.id)).toBe(false);
  });
});

describe("relationships", () => {
  it("links a page or the doc to people, tasks and docs, with backlinks, and never touches CRM records", async () => {
    const person = await createContact(db(), owner, tenant, { name: "Ada Linked", email: "ada@example.test", notes: "" });
    await withTenant(db(), owner, tenant, "tasks:write", (tx) => tx.insert(crmTasks).values({ tenantId: tenant, title: "Call Ada", createdBy: owner }));
    const d = await createDoc(db(), owner, tenant, { title: "Relations" }), target = await createDoc(db(), owner, tenant, { title: "Related doc" });
    const page = await firstPage(d.id);
    const before = (await fixture.admin.query("select version, updated_at from contacts where id=$1", [person.id])).rows[0];
    const [task] = await searchTargets(db(), owner, tenant, d.id, { kind: "task", q: "call" });
    expect(task.label).toBe("Call Ada");
    expect((await searchTargets(db(), owner, tenant, d.id, { kind: "contact", q: "ada" }))[0].id).toBe(person.id);
    expect((await searchTargets(db(), owner, tenant, d.id, { kind: "doc", q: "related" })).map((t) => t.id)).toEqual([target.id]);
    expect((await searchTargets(db(), owner, tenant, d.id, { kind: "doc", q: "relations" })).map((t) => t.id)).toEqual([]);
    await addLink(db(), owner, tenant, d.id, { kind: "contact", targetId: person.id, pageId: page });
    await addLink(db(), owner, tenant, d.id, { kind: "task", targetId: task.id, pageId: null });
    await addLink(db(), owner, tenant, d.id, { kind: "doc", targetId: target.id, pageId: page });
    expect((await addLink(db(), owner, tenant, d.id, { kind: "doc", targetId: target.id, pageId: page })).id).toBeNull();
    const onPage = await listLinks(db(), owner, tenant, d.id, { scope: "page", pageId: page });
    expect(onPage.links.map((l) => [l.kind, l.label]).sort()).toEqual([["contact", "Ada Linked"], ["doc", "Related doc"]]);
    expect((await listLinks(db(), owner, tenant, d.id, { scope: "doc" })).links).toHaveLength(3);
    const back = await listLinks(db(), owner, tenant, target.id, { scope: "doc" });
    expect(back.backlinks).toEqual([expect.objectContaining({ docId: d.id, docTitle: "Relations" })]);
    expect(await status(addLink(db(), owner, tenant, d.id, { kind: "doc", targetId: d.id }))).toBe(400);
    expect(await status(addLink(db(), owner, tenant, d.id, { kind: "contact", targetId: crypto.randomUUID() }))).toBe(404);
    expect(await status(addLink(db(), member, tenant, d.id, { kind: "doc", targetId: target.id }))).toBe(404);
    expect((await fixture.admin.query("select version, updated_at from contacts where id=$1", [person.id])).rows[0]).toEqual(before);
    // An erased person leaves no name behind: the link reads as unavailable.
    await eraseContact(db(), owner, tenant, person.id);
    expect((await listLinks(db(), owner, tenant, d.id, { scope: "doc" })).links.find((l) => l.kind === "contact")?.label).toBeNull();
    // Backlinks respect doc access: a member who cannot open the source doc does not see it.
    await setAccess(db(), owner, tenant, target.id, { visibility: "ministry", ministryAccess: "view" });
    expect((await listLinks(db(), member2, tenant, target.id, { scope: "doc" })).backlinks).toEqual([]);
    await removeLink(db(), owner, tenant, d.id, (await listLinks(db(), owner, tenant, d.id, { scope: "doc" })).links[0].id);
    expect((await listLinks(db(), owner, tenant, d.id, { scope: "doc" })).links).toHaveLength(2);
  });
});

describe("templates", () => {
  it("lists the starter templates, saves a doc or a page as a ministry template, applies it two ways and updates it", async () => {
    const all = await listTemplates(db(), member, tenant, {});
    expect(all.filter((t) => t.builtin).map((t) => t.id)).toEqual(expect.arrayContaining(["builtin:meeting-notes", "builtin:sermon-notes", "builtin:event-plan"]));
    expect((await listTemplates(db(), member, tenant, { q: "sermon" })).map((t) => t.id)).toEqual(["builtin:sermon-notes"]);
    expect((await listTemplates(db(), member, tenant, { category: "events" })).every((t) => t.category === "events")).toBe(true);
    const d = await createDoc(db(), member, tenant, { title: "Template source" });
    const page = await firstPage(d.id, member);
    await updatePage(db(), member, tenant, d.id, page, { version: 1, content: para("Source text") });
    const sub = (await createPage(db(), member, tenant, d.id, { parentId: page, title: "Sub" })).id;
    const saved = await saveTemplate(db(), member, tenant, { name: "Weekly plan", category: "planning", description: "Mine", from: { docId: d.id, scope: "doc" } });
    expect((await listTemplates(db(), member2, tenant, { q: "weekly" }))[0]).toMatchObject({ name: "Weekly plan", pages: 2, canChange: false });
    expect((await listTemplates(db(), member, tenant, { q: "weekly" }))[0].canChange).toBe(true);
    const target = await createDoc(db(), member2, tenant, { title: "Target" });
    const targetPage = await firstPage(target.id, member2);
    await applyTemplate(db(), member2, tenant, target.id, { template: saved.id, mode: "new_pages" });
    expect((await getDoc(db(), member2, tenant, target.id)).pages).toHaveLength(3);
    await applyTemplate(db(), member2, tenant, target.id, { template: "builtin:meeting-notes", mode: "replace_page", pageId: targetPage, version: 1 });
    expect(JSON.stringify((await getPage(db(), member2, tenant, target.id, targetPage)).content)).toContain("Agenda");
    expect((await listVersions(db(), member2, tenant, target.id, targetPage))[0]).toMatchObject({ reason: "template" });
    expect(await status(applyTemplate(db(), member2, tenant, target.id, { template: "builtin:nope", mode: "new_pages" }))).toBe(404);
    expect(await status(applyTemplate(db(), viewer, tenant, target.id, { template: saved.id, mode: "new_pages" }))).toBe(404);
    // Update from this page, rename; only the author or a manager may change a template.
    await updateTemplate(db(), member, tenant, saved.id, { name: "Weekly plan v2", from: { docId: d.id, scope: "page", pageId: sub } });
    expect((await listTemplates(db(), member, tenant, { q: "v2" }))[0]).toMatchObject({ name: "Weekly plan v2", pages: 1 });
    expect(await status(updateTemplate(db(), member2, tenant, saved.id, { name: "x" }))).toBe(403);
    expect(await status(deleteTemplate(db(), member2, tenant, saved.id))).toBe(403);
    expect(await status(saveTemplate(db(), viewer, tenant, { name: "No", from: { docId: d.id, scope: "doc" } }))).toBe(403);
    expect(await status(deleteTemplate(db(), admin, tenant, saved.id))).toBe(200);
    expect(await listTemplates(db(), other, elsewhere, {}).then((l) => l.filter((t) => !t.builtin))).toEqual([]);
  });
});

describe("page history", () => {
  it("snapshots earlier text (at most every ten minutes), views it, and restores it while keeping what it replaced", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "History" });
    const page = await firstPage(d.id);
    let version = 1;
    const save = async (text: string) => { version = (await updatePage(db(), owner, tenant, d.id, page, { version, content: para(text) })).version; };
    await save("first draft"); await save("second draft"); await save("third draft");
    let versions = await listVersions(db(), owner, tenant, d.id, page);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: "autosave", number: 1 });
    // The snapshot holds the text before the save (here the empty page the doc started with).
    expect((await getVersion(db(), owner, tenant, d.id, page, versions[0].id)).html).toBe("<p></p>");
    // Age the snapshot so the next save keeps another one.
    await fixture.admin.query("update doc_page_versions set created_at=now()-interval '11 minutes' where page_id=$1", [page]);
    await save("fourth draft");
    versions = await listVersions(db(), owner, tenant, d.id, page);
    expect(versions).toHaveLength(2);
    const old = versions[0];
    const restored = await restoreVersion(db(), owner, tenant, d.id, page, old.id, { version });
    expect(JSON.stringify((await getPage(db(), owner, tenant, d.id, page)).content)).toContain("third draft");
    expect(restored.version).toBe(version + 1);
    expect((await listVersions(db(), owner, tenant, d.id, page))[0].reason).toBe("restore");
    expect(await status(restoreVersion(db(), owner, tenant, d.id, page, old.id, { version }))).toBe(409);
    // Editors only: a viewer of the doc sees no history.
    await setAccess(db(), owner, tenant, d.id, { visibility: "ministry", ministryAccess: "view" });
    expect(await status(listVersions(db(), member2, tenant, d.id, page))).toBe(403);
    expect(await status(getVersion(db(), member2, tenant, d.id, page, old.id))).toBe(403);
    // Only 50 are kept.
    for (let i = 0; i < 55; i++) await fixture.admin.query("insert into doc_page_versions(tenant_id,doc_id,page_id,number,content,created_by) values($1,$2,$3,1,'{\"type\":\"doc\"}',$4)", [tenant, d.id, page, owner]);
    version = (await getPage(db(), owner, tenant, d.id, page)).version;
    await fixture.admin.query("update doc_page_versions set created_at=now()-interval '1 hour' where page_id=$1", [page]);
    await save("fifth draft");
    expect((await fixture.admin.query("select count(*)::int n from doc_page_versions where page_id=$1", [page])).rows[0].n).toBe(50);
  });
});

describe("export, import and attachments", () => {
  it("exports a page or the whole doc as Markdown or HTML and prints it", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Export me" });
    const page = await firstPage(d.id);
    await updatePage(db(), owner, tenant, d.id, page, { version: 1, content: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Head <b>" }] }, { type: "paragraph", content: [{ type: "text", text: "Body & more" }] }] } });
    const second = (await createPage(db(), owner, tenant, d.id, { title: "Second" })).id;
    const md = await exportDoc(db(), owner, tenant, d.id, { scope: "doc", format: "markdown" });
    expect(md.filename).toBe("Export-me.md");
    expect(md.body).toContain("## Head \\<b\\>");
    expect(md.body).toContain("# Second");
    const html = await exportDoc(db(), owner, tenant, d.id, { scope: "page", pageId: page, format: "html" });
    expect(html.body).toContain("<h2>Head &lt;b&gt;</h2>");
    expect(html.body).not.toContain("Second");
    expect((await printableDoc(db(), owner, tenant, d.id, { scope: "doc" })).pages.map((p) => p.id)).toEqual([page, second]);
    expect(await status(exportDoc(db(), member2, tenant, d.id, { scope: "doc" }))).toBe(404);
    expect(await status(exportDoc(db(), owner, tenant, d.id, { scope: "page", pageId: crypto.randomUUID() }))).toBe(404);
  });

  it("imports HTML and Markdown into a doc or as a new doc, splitting by heading, sanitised and capped", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Import target" });
    const page = await firstPage(d.id, member);
    const split = await importIntoDoc(db(), member, tenant, d.id, { format: "html", split: true, text: "<p>Intro</p><h1>One</h1><p>a</p><script>alert(1)</script><h1>Two</h1><p onclick='x()'>b</p><img src=x onerror=y>" });
    expect(split.pages).toBe(3);
    const pages = (await getDoc(db(), member, tenant, d.id)).pages;
    expect(pages.map((p) => p.title)).toEqual(["Import target", "Imported", "One", "Two"]);
    expect(JSON.stringify((await getPage(db(), member, tenant, d.id, pages[3].id)).content)).not.toMatch(/onclick|alert|onerror/);
    const md = await importIntoDoc(db(), member, tenant, d.id, { format: "markdown", split: false, text: "# Only\n\n- [x] done", title: "From file" });
    expect(md.pages).toBe(1);
    await importIntoDoc(db(), member, tenant, d.id, { format: "markdown", text: "Replacing text", mode: "replace_page", pageId: page, version: 1 });
    expect(JSON.stringify((await getPage(db(), member, tenant, d.id, page)).content)).toContain("Replacing text");
    expect((await listVersions(db(), member, tenant, d.id, page))[0].reason).toBe("import");
    expect(await status(importIntoDoc(db(), member, tenant, d.id, { format: "html", text: "x".repeat(1_000_001) }))).toBe(400);
    expect(await status(importIntoDoc(db(), member2, tenant, d.id, { format: "html", text: "<p>x</p>" }))).toBe(404);
    const made = await importAsNewDoc(db(), member2, tenant, { format: "markdown", split: true, text: "# A\n\nx\n\n# B\n\ny", title: "Imported doc" });
    const detail = await getDoc(db(), member2, tenant, made.id);
    expect(detail.doc).toMatchObject({ title: "Imported doc", ownerId: member2, visibility: "private" });
    expect(detail.pages.map((p) => p.title)).toEqual(["A", "B"]);
    expect(await status(importAsNewDoc(db(), viewer, tenant, { format: "html", text: "<p>x</p>" }))).toBe(403);
  });

  it("attaches ready uploads from this ministry only, lists and detaches them", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Attachments" });
    const file = async (tenantId: string, name: string, state = "ready", social = false) => (await fixture.admin.query("insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status,social_upload) select g,$1::uuid,$2,'workspaces/'||$1||'/files/'||g,$3,'text/plain',5,repeat('a',64),$4,$5 from (select gen_random_uuid() g) x returning id", [tenantId, tenantId === elsewhere ? other : owner, name, state, social])).rows[0].id as string;
    const ready = await file(tenant, "agenda.txt"), pending = await file(tenant, "later.txt", "pending"), foreign = await file(elsewhere, "foreign.txt");
    await attachFile(db(), owner, tenant, d.id, { fileId: ready });
    await attachFile(db(), owner, tenant, d.id, { fileId: ready });
    for (const bad of [pending, foreign]) expect(await status(attachFile(db(), owner, tenant, d.id, { fileId: bad }))).toBe(404);
    expect((await listAttachments(db(), owner, tenant, d.id)).map((a) => a.name)).toEqual(["agenda.txt"]);
    expect(await status(attachFile(db(), viewer, tenant, d.id, { fileId: ready }))).toBe(404);
    await setAccess(db(), owner, tenant, d.id, { visibility: "ministry", ministryAccess: "view" });
    expect(await status(attachFile(db(), member2, tenant, d.id, { fileId: ready }))).toBe(403);
    expect((await listAttachments(db(), member2, tenant, d.id)).map((a) => a.name)).toEqual(["agenda.txt"]);
    await detachFile(db(), owner, tenant, d.id, ready);
    expect(await listAttachments(db(), owner, tenant, d.id)).toEqual([]);
  });
});

describe("isolation", () => {
  it("keeps every new table inside its ministry and free of contact foreign keys", async () => {
    const { rows } = await fixture.admin.query(`select conrelid::regclass::text t, confrelid::regclass::text f from pg_constraint where contype='f' and conrelid::regclass::text in ('doc_shares','doc_comments','doc_links','doc_templates','doc_page_versions','doc_attachments','doc_notifications')`);
    expect(rows.map((r) => r.f)).not.toContain("contacts");
    const d = await createDoc(db(), owner, tenant, { title: "Isolation" });
    for (const fn of [() => listThreads(db(), other, elsewhere, d.id, crypto.randomUUID()), () => listLinks(db(), other, elsewhere, d.id, {}), () => getSharing(db(), other, elsewhere, d.id), () => listVersions(db(), other, elsewhere, d.id, crypto.randomUUID())]) expect(await status(fn())).toBe(404);
    expect(await listNotifications(db(), other, elsewhere)).toEqual({ items: [], unread: 0 });
  });
});
