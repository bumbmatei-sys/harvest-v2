import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { createDoc, createPage, getDoc, getPage, listDocs, setDocFavorite, updateDoc, updatePage } from "../../src/server/docs";
import { createComment, listThreads } from "../../src/server/docs-comments";
import { getPageShares, removePageShare, setPageShare } from "../../src/server/docs-page-shares";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

const owner = "ps-owner", member = "ps-member", member2 = "ps-member2", other = "ps-other";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string;
const db = () => fixture.db;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const para = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, member, member2, other].map((id) => ({ id, name: id.replace("ps-", "Name "), email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, owner, "Page share ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'member'),($1,$3,'member')", [tenant, member, member2]);
}, 120_000);
afterAll(async () => { await fixture?.close(); });

describe("share this page", () => {
  it("gives one person one page, never the rest of the doc", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Plan" });
    const first = (await getDoc(db(), member, tenant, d.id)).pages[0].id;
    const second = (await createPage(db(), member, tenant, d.id, { title: "Secret page" })).id;
    expect(await status(getDoc(db(), member2, tenant, d.id))).toBe(404);
    await setPageShare(db(), member, tenant, d.id, first, { userId: member2, role: "view" });
    // The doc opens with only the shared page; the other page and every doc-level door stay closed.
    const detail = await getDoc(db(), member2, tenant, d.id);
    expect(detail.pages.map((p) => p.id)).toEqual([first]);
    expect(detail.rights).toMatchObject({ read: true, write: false, manage: false, pageOnly: true });
    expect(detail.pageRoles).toEqual({ [first]: "view" });
    expect(await status(getPage(db(), member2, tenant, d.id, second))).toBe(404);
    expect((await getPage(db(), member2, tenant, d.id, first)).id).toBe(first);
    expect(await status(updateDoc(db(), member2, tenant, d.id, { title: "Mine now" }))).toBe(404);
    expect((await listDocs(db(), member2, tenant, {})).docs.some((x) => x.id === d.id)).toBe(true);
    // View cannot save or comment.
    expect(await status(updatePage(db(), member2, tenant, d.id, first, { version: 1, content: para("x") }))).toBe(403);
    expect(await status(createComment(db(), member2, tenant, d.id, first, { body: "hi" }))).toBe(403);
    // A non-member is shut out.
    expect(await status(getDoc(db(), other, tenant, d.id))).toBe(403);
  });

  it("lets a commenter comment and an editor edit that page only, without protection or structure", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Edit one page" });
    const first = (await getDoc(db(), member, tenant, d.id)).pages[0].id;
    await setPageShare(db(), member, tenant, d.id, first, { userId: member2, role: "comment" });
    await createComment(db(), member2, tenant, d.id, first, { body: "A remark" });
    expect((await listThreads(db(), member2, tenant, d.id, first)).threads.map((t) => t.body)).toEqual(["A remark"]);
    await setPageShare(db(), member, tenant, d.id, first, { userId: member2, role: "edit" });
    const saved = await updatePage(db(), member2, tenant, d.id, first, { version: 1, content: para("Edited by a page editor") });
    expect(saved.version).toBe(2);
    expect(await status(updatePage(db(), member2, tenant, d.id, first, { version: 2, protected: true }))).toBe(403);
    expect(await status(createPage(db(), member2, tenant, d.id, { title: "No" }))).toBe(404);
    expect((await getPage(db(), member, tenant, d.id, first)).content).toMatchObject({ content: [{ content: [{ text: "Edited by a page editor" }] }] });
  });

  it("is managed only by the doc's managers, and a person can give theirs up", async () => {
    const d = await createDoc(db(), member, tenant, { title: "Managed" });
    const first = (await getDoc(db(), member, tenant, d.id)).pages[0].id;
    expect(await status(setPageShare(db(), member2, tenant, d.id, first, { userId: member2, role: "edit" }))).toBe(404);
    expect(await status(setPageShare(db(), member, tenant, d.id, first, { userId: other, role: "view" }))).toBe(400);
    await setPageShare(db(), member, tenant, d.id, first, { userId: member2, role: "view" });
    expect((await getPageShares(db(), member, tenant, d.id, first)).shares).toMatchObject([{ userId: member2, role: "view" }]);
    expect(await status(removePageShare(db(), member2, tenant, d.id, first, member2))).toBe(200);
    expect(await status(getDoc(db(), member2, tenant, d.id))).toBe(404);
  });
});

describe("favorites and wiki", () => {
  it("keeps where a favorite shows (sidebar or top) per person", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Starred" });
    expect(await setDocFavorite(db(), owner, tenant, d.id, true)).toMatchObject({ placement: "top" });
    expect(await setDocFavorite(db(), owner, tenant, d.id, true, "sidebar")).toMatchObject({ placement: "sidebar" });
    expect((await getDoc(db(), owner, tenant, d.id)).doc.favoritePlacement).toBe("sidebar");
    expect((await listDocs(db(), owner, tenant, {})).docs.find((x) => x.id === d.id)?.favoritePlacement).toBe("sidebar");
    expect(await status(setDocFavorite(db(), owner, tenant, d.id, true, "left"))).toBe(400);
    await setDocFavorite(db(), owner, tenant, d.id, false);
    expect((await getDoc(db(), owner, tenant, d.id)).doc.favoritePlacement).toBeNull();
  });
  it("starts a blank wiki: a wiki-mode doc, still private", async () => {
    const d = await createDoc(db(), owner, tenant, { title: "Handbook", wiki: true });
    const detail = await getDoc(db(), owner, tenant, d.id);
    expect(detail.doc).toMatchObject({ wiki: true, visibility: "private" });
    expect(await status(getDoc(db(), member, tenant, d.id))).toBe(404);
  });
});
