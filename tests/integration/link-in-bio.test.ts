import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { emptyBioDefinition, type BioDefinition } from "../../src/lib/link-in-bio";
import { createContact, eraseContact } from "../../src/server/contacts";
import { mergeContacts } from "../../src/server/crm-merge";
import { checkBioHandle, getBioPage, getPublicBio, listBioMessages, saveBioDraft, transitionBioPage, updateBioMessage, deleteBioMessage, bioChoices, issueBioProof } from "../../src/server/link-in-bio";
import { respondToBioClick, respondToBioMessage, respondToBioProof } from "../../src/server/link-in-bio-public";
import { bioMessagesKey } from "../../src/server/link-in-bio-mode";
import { testDatabase } from "../database";
import { noNetwork, seedPeople } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
vi.mock("../../src/db/client", () => ({ getDb: () => fixture.db }));
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let people: Awaited<ReturnType<typeof seedPeople>>;
let fetchSpy: ReturnType<typeof noNetwork>;
const origin = "http://localhost:3000";
const db = () => fixture.db;
const status = (promise: Promise<unknown>) => promise.then(() => 200, (e: { status?: number; name?: string }) => e.status ?? (e.name === "ZodError" ? 400 : 500));
const link = (id: string, over: Record<string, unknown> = {}) => ({ type: "link" as const, id, hidden: false, tab: "home" as const, label: "Give", url: "https://example.org/give", icon: null, ...over });
const message = { type: "message" as const, id: "msg00001", hidden: false, tab: "partnership" as const, title: "Message me" };
const def = (blocks: BioDefinition["blocks"], name = "Grace Church"): BioDefinition => ({ ...emptyBioDefinition(name), blocks });
let version = 0;
async function save(user: string, handle: string | undefined, definition: BioDefinition) {
  const page = await saveBioDraft(db(), user, people.tenant, { version, ...(handle ? { handle } : {}), definition }); version = page.version; return page;
}
const ctx = (handle: string) => ({ params: Promise.resolve({ handle }) });
const request = (path: string, init: RequestInit & { ip?: string } = {}) => new Request(`${origin}${path}`, { ...init, headers: { origin, "content-type": "application/json", "x-forwarded-for": init.ip ?? "203.0.113.9", ...(init.headers as Record<string, string> | undefined) } });
async function proof(handle: string) { return (await (await respondToBioProof(request(`/l/${handle}/message`), ctx(handle))).json()).proof as string; }
async function send(handle: string, over: Record<string, unknown> = {}, ip = "203.0.113.9", wait = true) {
  const p = (over.proof as string | undefined) ?? await proof(handle);
  if (wait) await new Promise((r) => setTimeout(r, 1100));
  return respondToBioMessage(request(`/l/${handle}/message`, { method: "POST", ip, body: JSON.stringify({ proof: p, name: "Ana", email: "ana@example.test", message: "Hello there", consent: true, ...over }) }), ctx(handle));
}
/** A ready profile photo, set through the owner's definer as the editor does (the photo is required to publish). */
async function attachPhoto(kind: "photo" | "cover" = "photo") {
  const page = await getBioPage(db(), people.owner, people.tenant), file = randomUUID();
  await fixture.admin.query("insert into bio_files(id,tenant_id,page_id,key,kind,name,mime,size,checksum,status) values($1,$2,$3,$4,$5,'p.png','image/png',10,$6,'ready')", [file, people.tenant, page.id, `workspaces/${people.tenant}/bio/${page.id}/files/${file}`, kind, "c".repeat(64)]);
  const { withUser } = await import("../../src/server/tenancy");
  const result = await withUser(db(), people.owner, async (tx) => (await tx.execute(sql`select public.bio_photo_operate(${people.tenant}::uuid, 'set', ${file}::uuid, ${JSON.stringify({ version: page.version, kind })}::jsonb) r`)).rows[0].r as { outcome: string });
  expect(result.outcome).toBe("ok");
  version = (await getBioPage(db(), people.owner, people.tenant)).version;
  return file;
}
const messageRows = (tenant = people.tenant) => fixture.admin.query("select * from bio_messages where tenant_id=$1 order by created_at", [tenant]).then((r) => r.rows);

beforeAll(async () => {
  fetchSpy = noNetwork();
  fixture = await testDatabase({ migrationOwner: true });
  people = await seedPeople(fixture, "bio");
  vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES", "synthetic");
  vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES_TEST_KEY", "5a".repeat(32));
  vi.stubEnv("DATABASE_URL", fixture.appURL);
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", "t".repeat(40));
}, 180_000);
afterAll(async () => { vi.unstubAllEnvs(); fetchSpy?.mockRestore(); await fixture?.close(); });

describe("roles and isolation", () => {
  it("lets owners and admins open the editor and nobody else", async () => {
    const page = await getBioPage(db(), people.owner, people.tenant);
    version = page.version;
    expect(page.status).toBe("draft"); expect(page.handle).toBe("bio-ministry"); expect(page.draft.name).toBe("bio ministry");
    expect((await getBioPage(db(), people.admin, people.tenant)).id).toBe(page.id);
    for (const who of [people.member, people.viewer, people.outsider]) expect(await status(getBioPage(db(), who, people.tenant))).toBe(403);
    expect(await status(saveBioDraft(db(), people.member, people.tenant, { version, definition: def([link("aaaaaaaa")]) }))).toBe(403);
  });
  it("keeps each ministry's page separate and its direct table access closed to other roles", async () => {
    const other = await getBioPage(db(), people.outsider, people.other);
    expect(other.id).not.toBe((await getBioPage(db(), people.owner, people.tenant)).id);
    expect(await status(saveBioDraft(db(), people.outsider, people.tenant, { version, definition: def([link("aaaaaaaa")]) }))).toBe(403);
    const { withTenant } = await import("../../src/server/tenancy");
    // A member reaching the table through the app role sees no row; the same query as the owner sees exactly the ministry's own.
    const count = (user: string, tenant: string, role: "docs:read" | "bio:manage") => withTenant(db(), user, tenant, role, async (tx) => Number((await tx.execute(sql`select count(*)::int n from bio_pages`)).rows[0].n));
    expect(await count(people.member, people.tenant, "docs:read")).toBe(0);
    expect(await count(people.viewer, people.tenant, "docs:read")).toBe(0);
    expect(await count(people.owner, people.tenant, "bio:manage")).toBe(1);
    expect(await status(withTenant(db(), people.member, people.tenant, "docs:read", (tx) => tx.execute(sql`update bio_pages set status='published'`)))).toBe(500);
  });
});

describe("handle rules", () => {
  it("checks length, characters, reserved words and other ministries' handles", async () => {
    const check = (h: string) => checkBioHandle(db(), people.owner, people.tenant, h);
    expect(await check("ab")).toMatchObject({ problem: "length" });
    expect(await check("Bad Name")).toMatchObject({ problem: "characters" });
    expect(await check("admin")).toMatchObject({ problem: "reserved" });
    expect(await check("grace-church")).toEqual({ available: true, problem: null });
    await getBioPage(db(), people.outsider, people.other);
    await fixture.admin.query("update bio_pages set handle='taken-handle' where tenant_id=$1", [people.other]);
    expect(await check("taken-handle")).toMatchObject({ available: false, problem: "taken" });
    expect(await check("bio-ministry")).toEqual({ available: true, problem: null });
    expect(await status(save(people.owner, "taken-handle", def([link("aaaaaaaa")])))).toBe(409);
    expect(await status(save(people.owner, "admin", def([link("aaaaaaaa")])))).toBe(400);
  });
  it("is enforced by the database as well", async () => {
    for (const bad of ["admin", "ab", "BAD", "a--b"]) expect((await fixture.admin.query("select public.valid_bio_handle($1) ok", [bad])).rows[0].ok).toBe(false);
  });
});

describe("saving and publishing", () => {
  it("saves with a version check and normalises the draft", async () => {
    const stale = version;
    const saved = await save(people.owner, "grace-church", def([link("aaaaaaaa", { url: "https://Example.org/give" }), message]));
    expect(saved.handle).toBe("grace-church"); expect(saved.draft.blocks[0]).toMatchObject({ url: "https://example.org/give" });
    expect(await status(saveBioDraft(db(), people.owner, people.tenant, { version: stale, definition: def([link("aaaaaaaa")]) }))).toBe(409);
    expect(await status(saveBioDraft(db(), people.owner, people.tenant, { version, definition: { ...def([link("aaaaaaaa")]), blocks: [link("aaaaaaaa", { url: "http://example.org" })] } }))).toBe(400);
    expect(await status(saveBioDraft(db(), people.owner, people.tenant, { version, definition: def([{ type: "community", id: "cccccccc", hidden: false, tab: "home", communityId: randomUUID() }]) }))).toBe(400);
    expect(await status(saveBioDraft(db(), people.owner, people.tenant, { version, definition: def([{ type: "newsletter", id: "nnnnnnnn", hidden: false, tab: "home", slug: "no-such-form" }]) }))).toBe(400);
  });
  it("answers an unpublished page like a missing one, then serves only the published copy", async () => {
    expect(await getPublicBio(db(), "grace-church")).toBeNull(); expect(await getPublicBio(db(), "no-such-page")).toBeNull();
    expect(await status(transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: version - 1 }))).toBe(409);
    // The profile photo is required (founder decision 25 Nov).
    expect(await status(transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version }))).toBe(400);
    await attachPhoto();
    const published = await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    expect(published.status).toBe("published");
    const view = (await getPublicBio(db(), "grace-church"))!;
    expect(view).toMatchObject({ name: "Grace Church", ministryName: "bio ministry", hasPhoto: true, layout: "tabs", showCover: true, photoAlign: "center", iconStyle: "outline" });
    expect(view.tabs.flatMap((t) => t.blocks).map((b) => b.type)).toEqual(["link", "message"]);
    // Later edits stay in the draft until they are published; hidden blocks never reach the visitor.
    await save(people.owner, undefined, def([link("aaaaaaaa", { label: "Changed" }), link("hhhhhhhh", { hidden: true, label: "Secret" }), message], "Grace Church"));
    const still = (await getPublicBio(db(), "grace-church"))!;
    expect(JSON.stringify(still)).not.toContain("Changed"); expect(JSON.stringify(still)).not.toContain("Secret");
    expect((await getBioPage(db(), people.owner, people.tenant)).unpublishedChanges).toBe(true);
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const now = JSON.stringify(await getPublicBio(db(), "grace-church"));
    expect(now).toContain("Changed"); expect(now).not.toContain("Secret");
  });
  it("locks the address while published and refuses to publish an unready page", async () => {
    expect(await status(save(people.owner, "other-address", def([link("aaaaaaaa")])))).toBe(409);
    expect((await fixture.admin.query("select public.bio_transition($1,'publish',1) r", [people.tenant])).rows[0].r).toBe("not_found");
  });
  it("drops the message block when messages are not enabled, and the whole page in production", async () => {
    vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES", "");
    expect((await getPublicBio(db(), "grace-church"))!.tabs.map((t) => t.id)).toEqual(["home"]);
    vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES", "synthetic");
    expect((await getPublicBio(db(), "grace-church", { NODE_ENV: "production" }))).toBeNull();
  });
  it("unpublishes: the address is a 404 again, the draft is kept", async () => {
    const before = await getBioPage(db(), people.owner, people.tenant);
    const result = await transitionBioPage(db(), people.owner, people.tenant, { action: "unpublish", version: before.version });
    expect(result.status).toBe("draft"); expect(result.draft.blocks.length).toBe(3);
    expect(await getPublicBio(db(), "grace-church")).toBeNull();
    expect((await fixture.admin.query("select published from bio_pages where tenant_id=$1", [people.tenant])).rows[0].published).toBeNull();
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: result.version });
  });
});

describe("clicks", () => {
  it("counts aggregate clicks per block with no personal data, only for published visible blocks", async () => {
    const click = (block: string, ip = "198.51.100.1") => respondToBioClick(request("/l/grace-church/click", { method: "POST", ip, body: JSON.stringify({ block }) }), ctx("grace-church"));
    expect((await click("aaaaaaaa")).status).toBe(204); expect((await click("aaaaaaaa", "198.51.100.2")).status).toBe(204);
    expect((await click("hhhhhhhh")).status).toBe(404); expect((await click("msg00001")).status).toBe(404); expect((await click("zzzzzzzz")).status).toBe(404);
    expect((await respondToBioClick(request("/l/nope-page/click", { method: "POST", body: JSON.stringify({ block: "aaaaaaaa" }) }), ctx("nope-page"))).status).toBe(404);
    expect((await respondToBioClick(request("/l/grace-church/click", { method: "POST", body: "{}" }), ctx("grace-church"))).status).toBe(404);
    expect((await respondToBioClick(new Request(`${origin}/l/grace-church/click`, { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-for": "198.51.100.3" }, body: JSON.stringify({ block: "aaaaaaaa" }) }), ctx("grace-church"))).status).toBe(404);
    expect((await getBioPage(db(), people.owner, people.tenant)).clicks).toEqual({ aaaaaaaa: 2 });
    const columns = (await fixture.admin.query("select column_name from information_schema.columns where table_name='bio_clicks' order by 1")).rows.map((r) => r.column_name);
    expect(columns).toEqual(["block_id", "clicks", "day", "page_id", "tenant_id"]);
    for (let i = 0; i < 60; i++) await click("aaaaaaaa", "198.51.100.7");
    expect((await click("aaaaaaaa", "198.51.100.7")).status).toBe(429);
    expect((await click("aaaaaaaa", "198.51.100.8")).status).toBe(204);
  });
});

describe("Message me", () => {
  it("stores the message, creates the person, shows the fixed consent notice and sends nothing", async () => {
    const response = await send("grace-church");
    expect(response.status).toBe(200);
    const [row] = await messageRows();
    expect(row).toMatchObject({ name: "Ana", email: "ana@example.test", body: "Hello there", status: "new", created_contact: true, notice: "Your details go to bio ministry. You can ask them to delete them." });
    expect(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()).toBe(90 * 86_400_000);
    const contact = (await fixture.admin.query("select c.name, i.normalized_value from contacts c join contact_identifiers i on i.contact_id=c.id and i.tenant_id=c.tenant_id where c.id=$1", [row.contact_id])).rows;
    expect(contact).toEqual([{ name: "Ana", normalized_value: "ana@example.test" }]);
    expect((await fixture.admin.query("select count(*)::int n from contact_consents where tenant_id=$1", [people.tenant])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select actor_id from audit_logs where action='bio.message.submit' and tenant_id=$1", [people.tenant])).rows).toEqual([{ actor_id: null }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await fixture.admin.query("select count(*)::int n from outbox_events where tenant_id=$1", [people.tenant])).rows[0].n).toBe(0);
  });
  it("reuses the person on the same address and never renames them", async () => {
    expect((await send("grace-church", { name: "Someone Else", message: "Second" }, "203.0.113.10")).status).toBe(200);
    const rows = await messageRows();
    expect(rows).toHaveLength(2); expect(rows[1].created_contact).toBe(false); expect(rows[1].contact_id).toBe(rows[0].contact_id);
    expect((await fixture.admin.query("select name from contacts where id=$1", [rows[0].contact_id])).rows[0].name).toBe("Ana");
  });
  it("refuses a missing consent, a honeypot, a tampered or early proof, a real address and an unknown page", async () => {
    const count = async () => (await messageRows()).length, before = await count();
    expect((await send("grace-church", { consent: false }, "203.0.113.11")).status).toBe(400);
    expect((await send("grace-church", { website: "http://spam.example" }, "203.0.113.11")).status).toBe(400);
    expect((await send("grace-church", { proof: "x.y.z" }, "203.0.113.11", false)).status).toBe(400);
    expect((await send("grace-church", {}, "203.0.113.11", false)).status).toBe(400);
    expect((await send("grace-church", { email: "real@gmail.com" }, "203.0.113.11")).status).toBe(400);
    const other = issueBioProof("someone-else", bioMessagesKey()!);
    expect((await send("grace-church", { proof: other }, "203.0.113.11", false)).status).toBe(400);
    expect((await send("no-such-page", { proof: other }, "203.0.113.11", false)).status).toBe(400);
    expect((await respondToBioProof(request("/l/no-such-page/message"), ctx("no-such-page"))).status).toBe(404);
    expect(await count()).toBe(before);
  });
  it("rejects a foreign origin, a non-JSON body and an oversized body without storing anything", async () => {
    const p = await proof("grace-church");
    const base = { method: "POST", headers: { "x-forwarded-for": "203.0.113.12" } };
    expect((await respondToBioMessage(new Request(`${origin}/l/grace-church/message`, { ...base, headers: { ...base.headers, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ proof: p }) }), ctx("grace-church"))).status).toBe(404);
    expect((await respondToBioMessage(new Request(`${origin}/l/grace-church/message`, { ...base, headers: { ...base.headers, origin, "content-type": "text/plain" }, body: "x" }), ctx("grace-church"))).status).toBe(415);
    expect((await respondToBioMessage(new Request(`${origin}/l/grace-church/message`, { ...base, headers: { ...base.headers, origin, "content-type": "application/json" }, body: "x".repeat(9000) }), ctx("grace-church"))).status).toBe(413);
  });
  it("replays one proof safely and rate limits a visitor", async () => {
    const p = await proof("grace-church");
    const again = () => send("grace-church", { proof: p, name: "Replay", email: "replay@example.test", message: "once" }, "203.0.113.20", false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await again()).status).toBe(200); expect((await again()).status).toBe(200);
    expect((await messageRows()).filter((r) => r.email === "replay@example.test")).toHaveLength(1);
    expect((await send("grace-church", { proof: p, email: "replay@example.test", message: "different text" }, "203.0.113.20", false)).status).toBe(409);
    const statuses: number[] = [], proofs = await Promise.all(Array.from({ length: 6 }, () => proof("grace-church")));
    await new Promise((r) => setTimeout(r, 1100));
    for (let i = 0; i < 6; i++) statuses.push((await send("grace-church", { proof: proofs[i], email: `flood${i}@example.test` }, "203.0.113.30", false)).status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(5); expect(statuses.at(-1)).toBe(429);
  });
  it("is closed when messages are not enabled or the database is not a test database", async () => {
    vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES", "");
    expect((await respondToBioProof(request("/l/grace-church/message"), ctx("grace-church"))).status).toBe(404);
    vi.stubEnv("HARVEST_LINK_IN_BIO_MESSAGES", "synthetic");
    const bad = await fixture.admin.query("select 1");
    expect(bad.rowCount).toBe(1);
  });
  it("lists, marks and deletes messages for owners and admins only, and purges expired ones", async () => {
    const list = await listBioMessages(db(), people.admin, people.tenant);
    expect(list.available).toBe(true); expect(list.messages.length).toBeGreaterThanOrEqual(2);
    expect(await status(listBioMessages(db(), people.member, people.tenant))).toBe(403);
    const first = list.messages.at(-1)!;
    expect((await updateBioMessage(db(), people.owner, people.tenant, first.id, { status: "handled" })).status).toBe("handled");
    expect(await status(updateBioMessage(db(), people.outsider, people.tenant, first.id, { status: "new" }))).toBe(403);
    expect(await status(updateBioMessage(db(), people.owner, people.tenant, randomUUID(), { status: "new" }))).toBe(404);
    await fixture.admin.query("update bio_messages set created_at = now() - interval '91 days', expires_at = now() - interval '1 day' where tenant_id=$1 and id=$2", [people.tenant, first.id]);
    expect((await listBioMessages(db(), people.owner, people.tenant)).messages.some((m) => m.id === first.id)).toBe(false);
    expect((await messageRows()).some((r) => r.id === first.id)).toBe(false);
    const next = (await listBioMessages(db(), people.owner, people.tenant)).messages[0];
    await deleteBioMessage(db(), people.owner, people.tenant, next.id);
    expect(await status(deleteBioMessage(db(), people.owner, people.tenant, next.id))).toBe(404);
  });
  it("moves messages to the kept person on merge and removes them on erasure", async () => {
    const fresh = (await send("grace-church", { email: "merge@example.test", name: "Mara", message: "to merge" }, "203.0.113.40")); expect(fresh.status).toBe(200);
    const row = (await messageRows()).find((r) => r.email === "merge@example.test")!;
    const target = await createContact(db(), people.owner, people.tenant, { name: "Merge target" });
    await mergeContacts(db(), people.owner, people.tenant, target.id, { sourceId: row.contact_id, sourceVersion: 1, targetVersion: target.version });
    expect((await messageRows()).find((r) => r.email === "merge@example.test")!.contact_id).toBe(target.id);
    await eraseContact(db(), people.owner, people.tenant, target.id);
    expect((await messageRows()).some((r) => r.email === "merge@example.test")).toBe(false);
  });
});

describe("photo, choices and cross-ministry safety", () => {
  it("accepts a photo only from the page's own ready files", async () => {
    const page = await getBioPage(db(), people.owner, people.tenant);
    const file = randomUUID();
    await fixture.admin.query("insert into bio_files(id,tenant_id,page_id,key,name,mime,size,checksum,status) values($1,$2,$3,$4,'p.png','image/png',10,$5,'pending')", [file, people.tenant, page.id, `workspaces/${people.tenant}/bio/${page.id}/files/${file}`, "a".repeat(64)]);
    const set = (user: string, tenant: string, id: string | null) => db().execute(sql`select public.bio_photo_operate(${tenant}::uuid, 'set', ${id}::uuid, ${JSON.stringify({ version: page.version })}::jsonb) r`).catch(() => null);
    const { withUser } = await import("../../src/server/tenancy");
    const run = (user: string, tenant: string, id: string | null, v = page.version) => withUser(db(), user, async (tx) => (await tx.execute(sql`select public.bio_photo_operate(${tenant}::uuid, 'set', ${id}::uuid, ${JSON.stringify({ version: v })}::jsonb) r`)).rows[0].r as { outcome: string });
    void set;
    expect((await run(people.owner, people.tenant, file)).outcome).toBe("not_found");
    await fixture.admin.query("update bio_files set status='ready' where id=$1", [file]);
    expect((await run(people.member, people.tenant, file)).outcome).toBe("not_found");
    expect((await run(people.outsider, people.other, file)).outcome).not.toBe("ok");
    expect((await run(people.owner, people.tenant, file, 1)).outcome).toBe("conflict");
    expect((await run(people.owner, people.tenant, file)).outcome).toBe("ok");
    expect((await getBioPage(db(), people.owner, people.tenant)).photoFileId).toBe(file);
    await expect(fixture.admin.query("update bio_pages set photo_file_id=$1 where tenant_id=$2", [randomUUID(), people.tenant])).rejects.toThrow();
  });
  it("offers only this ministry's communities and published sign-up forms", async () => {
    expect(await bioChoices(db(), people.owner, people.tenant)).toEqual({ communities: [], signups: [], giving: [], catalog: [], forms: [] });
    expect(await status(bioChoices(db(), people.member, people.tenant))).toBe(403);
  });
  it("keeps the anonymous functions out of PUBLIC and pinned to a fixed search path", async () => {
    const { rows } = await fixture.admin.query(`select p.proname, p.prosecdef, p.proconfig, has_function_privilege('public', p.oid, 'execute') pub from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'bio\\_%'`);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) { expect(row.pub, row.proname).toBe(false); expect(row.proconfig?.some((c: string) => c.startsWith("search_path=")), row.proname).toBe(true); }
    expect(rows.filter((r) => r.prosecdef).map((r) => r.proname).sort()).toEqual(expect.arrayContaining(["bio_public_page", "bio_record_click", "bio_submit_message", "bio_transition"]));
    for (const table of ["bio_pages", "bio_files", "bio_clicks", "bio_messages", "bio_quotas", "bio_receipts"]) {
      const { rows: [t] } = await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname=$1", [table]);
      expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });
});

describe("tabs, details and the cover", () => {
  it("drops the details list and keeps one line of short bio (founder decision 27 Nov), and shows no hidden tab or its blocks", async () => {
    version = (await getBioPage(db(), people.owner, people.tenant)).version;
    const detail = (id: string, kind: "location" | "role", value: string, hidden: boolean) => ({ id, kind, value, hidden });
    const definition: BioDefinition = { ...def([link("aaaaaaaa"), message]), subtitle: "Church planter", bio: "", details: [detail("dddddd01", "location", "Lisbon", false), detail("dddddd02", "role", "Pastor", true)],
      tabs: [{ id: "home", label: "", hidden: false }, { id: "partnership", label: "", hidden: false }] };
    const saved = await save(people.owner, undefined, definition);
    expect(saved.draft).toMatchObject({ subtitle: "", bio: "Church planter", details: [] });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const open = (await getPublicBio(db(), "grace-church"))!;
    expect(open.bio).toBe("Church planter");
    expect(JSON.stringify(open)).not.toContain("Pastor"); expect(JSON.stringify(open)).not.toContain("Lisbon");
    await save(people.owner, undefined, { ...definition, subtitle: "", bio: "\n  First line  \nSecond line" });
    expect((await getBioPage(db(), people.owner, people.tenant)).draft.bio).toBe("First line");
    expect((await respondToBioProof(request("/l/grace-church/message"), ctx("grace-church"))).status).toBe(200);
    await save(people.owner, undefined, { ...definition, tabs: [{ id: "partnership", label: "", hidden: true }, { id: "home", label: "", hidden: false }] });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const closed = (await getPublicBio(db(), "grace-church"))!;
    expect(closed.tabs.map((t) => t.id)).toEqual(["home"]);
    expect((await respondToBioProof(request("/l/grace-church/message"), ctx("grace-church"))).status).toBe(404);
    expect((await fixture.admin.query("select public.bio_submit_message('grace-church', gen_random_uuid(), now() + interval '5 minutes', 'A', 'a@example.test', 'b', $1, $2) r", ["a".repeat(64), "b".repeat(64)])).rows[0].r).toBe("not_found");
  });
  it("keeps the cover and the photo as separate files of one page", async () => {
    const page = await getBioPage(db(), people.owner, people.tenant);
    const file = randomUUID();
    await fixture.admin.query("insert into bio_files(id,tenant_id,page_id,key,kind,name,mime,size,checksum,status) values($1,$2,$3,$4,'cover','c.png','image/png',10,$5,'ready')", [file, people.tenant, page.id, `workspaces/${people.tenant}/bio/${page.id}/files/${file}`, "b".repeat(64)]);
    const { withUser } = await import("../../src/server/tenancy");
    const set = (kind: string) => withUser(db(), people.owner, async (tx) => (await tx.execute(sql`select public.bio_photo_operate(${people.tenant}::uuid, 'set', ${file}::uuid, ${JSON.stringify({ version: page.version, kind })}::jsonb) r`)).rows[0].r as { outcome: string });
    expect((await set("photo")).outcome).toBe("not_found");
    expect((await set("cover")).outcome).toBe("ok");
    expect((await getBioPage(db(), people.owner, people.tenant)).coverFileId).toBe(file);
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version: page.version + 1 });
    expect((await getPublicBio(db(), "grace-church"))).toMatchObject({ hasCover: true, hasPhoto: true });
    const { rows } = await fixture.admin.query("select public.bio_public_photo('grace-church', 'cover') c, public.bio_public_photo('grace-church', 'photo') p");
    expect(rows[0].c.key).toContain(file); expect(rows[0].p.key).not.toContain(file);
  });
  it("will not publish when every visible block sits in a tab that is hidden or missing from the list", async () => {
    version = (await getBioPage(db(), people.owner, people.tenant)).version;
    await save(people.owner, undefined, { ...def([message]), tabs: [{ id: "home", label: "", hidden: false }] });
    expect(await status(transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version }))).toBe(400);
    await save(people.owner, undefined, { ...def([link("aaaaaaaa")]), tabs: [{ id: "home", label: "", hidden: true }, { id: "partnership", label: "", hidden: false }] });
    expect(await status(transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version }))).toBe(400);
    expect((await fixture.admin.query("select public.bio_block_shown($1::jsonb, $2::jsonb) a, public.bio_block_shown($3::jsonb, $2::jsonb) b", [JSON.stringify({ tabs: [{ id: "home", label: "", hidden: false }] }), JSON.stringify({ hidden: false, tab: "partnership" }), JSON.stringify({ tabs: [{ id: "partnership", label: "", hidden: false }] })])).rows[0]).toEqual({ a: false, b: true });
  });
});

describe("rework: named tabs, single page, cover switch (0134)", () => {
  const tab = (id: string, label: string, hidden = false) => ({ id, label, hidden });
  it("serves up to six named tabs in the owner's order and never a hidden one", async () => {
    version = (await getBioPage(db(), people.owner, people.tenant)).version;
    const tabs = [tab("tabaaaaa", "Watch"), tab("home", ""), tab("tabbbbbb", "Give", true), tab("tabccccc", "Pray"), tab("tabddddd", "Events"), tab("tabeeeee", "About")];
    const definition: BioDefinition = { ...def([link("aaaaaaaa", { tab: "tabaaaaa" }), link("bbbbbbbb", { tab: "home" }), link("cccccccc", { tab: "tabbbbbb", label: "Hidden tab link" }), link("dddddddd", { tab: "tabccccc" })]),
      tabs, photoAlign: "left", iconStyle: "color" };
    const page = await save(people.owner, undefined, definition);
    expect(page.draft.tabs.map((t) => t.label)).toEqual(["Watch", "", "Give", "Pray", "Events", "About"]);
    expect(await status(save(people.owner, undefined, { ...definition, tabs: [...tabs, tab("tabfffff", "Seven")] }))).toBe(400);
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const view = (await getPublicBio(db(), "grace-church"))!;
    // Empty tabs are left out; the hidden tab and its block never reach the visitor.
    expect(view.tabs.map((t) => [t.id, t.label, t.blocks.map((b) => b.id)])).toEqual([["tabaaaaa", "Watch", ["aaaaaaaa"]], ["home", "", ["bbbbbbbb"]], ["tabccccc", "Pray", ["dddddddd"]]]);
    expect(JSON.stringify(view)).not.toContain("Hidden tab link");
    expect(view).toMatchObject({ layout: "tabs", photoAlign: "left", iconStyle: "color" });
    // Clicks follow the same rule in the database.
    const click = (block: string) => respondToBioClick(request("/l/grace-church/click", { method: "POST", body: JSON.stringify({ block }), ip: "203.0.113.77" }), ctx("grace-church")).then((r) => r.status);
    expect(await click("dddddddd")).toBe(204);
    expect(await click("cccccccc")).toBe(404);
  });
  it("shows every visible block on one page in the single-page layout, in the database too", async () => {
    const current = await getBioPage(db(), people.owner, people.tenant); version = current.version;
    await save(people.owner, undefined, { ...current.draft, layout: "single" });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const view = (await getPublicBio(db(), "grace-church"))!;
    expect(view.layout).toBe("single");
    expect(view.tabs).toHaveLength(1);
    expect(view.tabs[0].blocks.map((b) => b.id)).toEqual(["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"]);
    const click = (block: string) => respondToBioClick(request("/l/grace-church/click", { method: "POST", body: JSON.stringify({ block }), ip: "203.0.113.78" }), ctx("grace-church")).then((r) => r.status);
    expect(await click("cccccccc")).toBe(204);
    const shown = (published: unknown, block: unknown) => fixture.admin.query("select public.bio_block_shown($1::jsonb, $2::jsonb) r", [JSON.stringify(published), JSON.stringify(block)]).then((r) => r.rows[0].r);
    expect(await shown({ layout: "single", tabs: [] }, { hidden: false, tab: "zzzzzzzz" })).toBe(true);
    expect(await shown({ layout: "single", tabs: [] }, { hidden: true, tab: "home" })).toBe(false);
    expect(await shown({ tabs: [{ id: "home", hidden: false }] }, { hidden: false })).toBe(true);
  });
  it("hides the cover image when the cover is switched off, and brings it back when switched on", async () => {
    await attachPhoto("cover");
    const current = await getBioPage(db(), people.owner, people.tenant); version = current.version;
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const coverKey = async () => (await fixture.admin.query("select public.bio_public_photo('grace-church', 'cover') c")).rows[0].c;
    expect(await coverKey()).not.toBeNull();
    await save(people.owner, undefined, { ...current.draft, cover: false });
    expect(await coverKey()).not.toBeNull(); // Only the published copy counts.
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    expect(await coverKey()).toBeNull();
    expect((await getPublicBio(db(), "grace-church"))).toMatchObject({ showCover: false, hasCover: false, hasPhoto: true });
    expect((await fixture.admin.query("select public.bio_public_photo('grace-church', 'photo') p")).rows[0].p).not.toBeNull();
    await save(people.owner, undefined, { ...current.draft, cover: true });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    expect(await coverKey()).not.toBeNull();
  });
  it("reads a page saved before the rework with the new defaults", async () => {
    const old = { kind: "bio-v1", name: "Grace Church", subtitle: "", bio: "", details: [], tabs: [{ id: "home", hidden: false }, { id: "partnership", hidden: false }], scheme: "auto", buttons: "filled", socials: [],
      blocks: [{ type: "link", id: "aaaaaaaa", hidden: false, tab: "partnership", label: "Give", url: "https://example.org/give", icon: null }] };
    await fixture.admin.query("update bio_pages set draft=$1::jsonb, published=$1::jsonb where tenant_id=$2", [JSON.stringify(old), people.tenant]);
    const page = await getBioPage(db(), people.owner, people.tenant);
    expect(page.draft).toMatchObject({ layout: "tabs", cover: true, photoAlign: "center", iconStyle: "outline", tabs: [{ id: "home", label: "", hidden: false }, { id: "partnership", label: "", hidden: false }] });
    const view = (await getPublicBio(db(), "grace-church"))!;
    expect(view.tabs.map((t) => t.id)).toEqual(["partnership"]);
    const click = await respondToBioClick(request("/l/grace-church/click", { method: "POST", body: JSON.stringify({ block: "aaaaaaaa" }), ip: "203.0.113.79" }), ctx("grace-church"));
    expect(click.status).toBe(204);
  });
});

describe("rework PR 2: new blocks (0135)", () => {
  const catalogRow = async (tenant: string, kind: "course" | "download", state: string, visibility: string, title: string) => {
    const id = randomUUID();
    await fixture.admin.query("insert into catalog_items(tenant_id,id,kind,slug,title,summary,state,visibility) values($1,$2,$3,$4,$5,'Synthetic summary',$6,$7)",
      [tenant, id, kind, `bio-${kind}-${id.slice(0, 8)}`, title, state, visibility]);
    return id;
  };
  const click = (block: string, ip: string) => respondToBioClick(request("/l/grace-church/click", { method: "POST", body: JSON.stringify({ block }), ip }), ctx("grace-church")).then((r) => r.status);
  it("shows only the ministry's published, not hidden products and courses, and only download products as files", async () => {
    const listed = await catalogRow(people.tenant, "course", "published", "listed", "Listed course");
    const unlisted = await catalogRow(people.tenant, "download", "published", "unlisted", "Unlisted ebook");
    const draft = await catalogRow(people.tenant, "download", "draft", "listed", "Draft ebook");
    const hidden = await catalogRow(people.tenant, "course", "published", "hidden", "Hidden course");
    const foreign = await catalogRow(people.other, "course", "published", "listed", "Other ministry course");
    const current = await getBioPage(db(), people.owner, people.tenant); version = current.version;
    const blocks: BioDefinition["blocks"] = [
      { type: "catalog", id: "catalog1", hidden: false, tab: "home", title: "Learn with us", itemIds: [listed, unlisted, draft, hidden] },
      { type: "files", id: "files001", hidden: false, tab: "home", title: "", itemIds: [unlisted, draft] },
      { type: "video", id: "video001", hidden: false, tab: "home", title: "Welcome", provider: "youtube", videoId: "dQw4w9WgXcQ" },
      { type: "contact", id: "contact1", hidden: false, tab: "home", email: "hello@example.invalid", phone: "+351 912 345 678", whatsapp: "" },
      { type: "location", id: "locate01", hidden: false, tab: "home", label: "Sunday", address: "Rua Augusta 1, Lisboa" },
      { type: "live", id: "liveoff1", hidden: false, tab: "home", title: "Live service", url: "https://example.org/live", on: false },
      { type: "testimonials", id: "testim01", hidden: false, tab: "home", items: [{ id: "quote001", quote: "Synthetic quote.", name: "Ana", role: "" }] },
    ];
    const definition: BioDefinition = { ...current.draft, layout: "single", blocks };
    // Another ministry's item, and a course in the files block, are refused when saving.
    expect(await status(save(people.owner, undefined, { ...definition, blocks: [{ type: "catalog", id: "catalog1", hidden: false, tab: "home", title: "", itemIds: [foreign] }] }))).toBe(400);
    expect(await status(save(people.owner, undefined, { ...definition, blocks: [{ type: "files", id: "files001", hidden: false, tab: "home", title: "", itemIds: [listed] }] }))).toBe(400);
    expect(await status(save(people.owner, undefined, { ...definition, blocks: [{ type: "form", id: "form0001", hidden: false, tab: "home", title: "Pray", slug: "no-such-form" }] }))).toBe(400);
    await save(people.owner, undefined, definition);
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const view = (await getPublicBio(db(), "grace-church"))!;
    const byId = Object.fromEntries(view.tabs[0].blocks.map((b) => [b.id, b]));
    expect((byId.catalog1 as { items: { title: string }[] }).items.map((x) => x.title)).toEqual(["Listed course", "Unlisted ebook"]);
    expect((byId.files001 as { items: { title: string }[] }).items.map((x) => x.title)).toEqual(["Unlisted ebook"]);
    expect(byId.video001).toMatchObject({ video: { provider: "youtube", id: "dQw4w9WgXcQ" } });
    expect(byId.liveoff1).toBeUndefined();
    expect(Object.keys(byId)).toEqual(["catalog1", "files001", "video001", "contact1", "locate01", "testim01"]);
    expect(JSON.stringify(view)).not.toContain("Draft ebook"); expect(JSON.stringify(view)).not.toContain("Hidden course");
    // Clicks: counted for the new blocks that lead somewhere; Live now only while it is on; never for testimonials.
    expect(await click("catalog1", "203.0.113.90")).toBe(204);
    expect(await click("contact1", "203.0.113.90")).toBe(204);
    expect(await click("liveoff1", "203.0.113.90")).toBe(404);
    expect(await click("testim01", "203.0.113.90")).toBe(404);
    await save(people.owner, undefined, { ...definition, blocks: blocks.map((b) => b.type === "live" ? { ...b, on: true } : b) });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    expect((await getPublicBio(db(), "grace-church"))!.tabs[0].blocks.find((b) => b.id === "liveoff1")).toMatchObject({ type: "live", url: "https://example.org/live" });
    expect(await click("liveoff1", "203.0.113.91")).toBe(204);
    // Unpublishing an item takes it off the page at once, without republishing the page.
    await fixture.admin.query("update catalog_items set visibility='hidden' where id=$1", [listed]);
    expect(JSON.stringify(await getPublicBio(db(), "grace-church"))).not.toContain("Listed course");
  });
  it("clears the catalog flags it sets and restores the caller's", async () => {
    const client = await fixture.admin.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.catalog_tenant', $1, true), set_config('app.catalog_slug', 'caller-slug', true)", [people.other]);
      const { rows: [row] } = await client.query("select public.bio_public_page('grace-church') r, current_setting('app.catalog_tenant', true) t, current_setting('app.catalog_slug', true) s");
      expect(row.r).not.toBeNull(); expect(row.t).toBe(people.other); expect(row.s).toBe("caller-slug");
      const { rows: [clear] } = await client.query("select public.bio_scope_clear(false) ? 'app.catalog_tenant' a, current_setting('app.catalog_tenant', true) t");
      expect(clear).toEqual({ a: true, t: "" });
      await client.query("rollback");
    } finally { client.release(); }
  });
});

describe("rework PR 3: gallery, share and countdown (0136)", () => {
  const galleryFile = async (status: "ready" | "pending", tenant = people.tenant) => {
    const page = await getBioPage(db(), tenant === people.tenant ? people.owner : people.outsider, tenant), id = randomUUID();
    await fixture.admin.query("insert into bio_files(id,tenant_id,page_id,key,kind,name,mime,size,checksum,status) values($1,$2,$3,$4,'gallery','g.png','image/png',10,$5,$6)",
      [id, tenant, page.id, `workspaces/${tenant}/bio/${page.id}/files/${id}`, "e".repeat(64), status]);
    return id;
  };
  const publicPicture = (handle: string, file: string) => fixture.admin.query("select public.bio_public_gallery($1, $2::uuid) r", [handle, file]).then((r) => r.rows[0].r as { key: string } | null);
  it("serves only ready gallery pictures that a shown gallery block of the published page lists", async () => {
    const ready = await galleryFile("ready"), pending = await galleryFile("pending"), unlisted = await galleryFile("ready"), foreign = await galleryFile("ready", people.other);
    const current = await getBioPage(db(), people.owner, people.tenant); version = current.version;
    const blocks: BioDefinition["blocks"] = [
      { type: "gallery", id: "gallery1", hidden: false, tab: "home", title: "Our church", fileIds: [ready, pending, foreign] },
      { type: "share", id: "share001", hidden: false, tab: "home", title: "Share" },
      { type: "countdown", id: "count001", hidden: false, tab: "home", title: "Easter", at: "2027-03-28T09:00:00.000Z", url: "" },
    ];
    await save(people.owner, undefined, { ...current.draft, layout: "single", blocks });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const view = (await getPublicBio(db(), "grace-church"))!;
    expect(view.tabs[0].blocks.find((b) => b.id === "gallery1")).toMatchObject({ type: "gallery", fileIds: [ready] });
    expect(view.tabs[0].blocks.map((b) => b.type)).toEqual(["gallery", "share", "countdown"]);
    expect((await publicPicture("grace-church", ready))?.key).toContain(ready);
    for (const other of [pending, unlisted, foreign]) expect(await publicPicture("grace-church", other)).toBeNull();
    // Hidden block: the picture is no longer served.
    await save(people.owner, undefined, { ...current.draft, layout: "single", blocks: blocks.map((b) => b.type === "gallery" ? { ...b, hidden: true } : b) });
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    expect(await publicPicture("grace-church", ready)).toBeNull();
    // Owner preview: the gallery picture by id through the owner's definer; a gallery picture is never "set" on the page.
    const { withUser } = await import("../../src/server/tenancy");
    const operate = (action: string, file: string | null, input: object) => withUser(db(), people.owner, async (tx) => (await tx.execute(sql`select public.bio_photo_operate(${people.tenant}::uuid, ${action}, ${file}::uuid, ${JSON.stringify(input)}::jsonb) r`)).rows[0].r as { outcome: string });
    expect((await operate("serve", ready, { kind: "gallery" })).outcome).toBe("ok");
    expect((await operate("serve", pending, { kind: "gallery" })).outcome).toBe("not_found");
    expect((await operate("set", ready, { kind: "gallery", version })).outcome).toBe("invalid");
    expect((await withUser(db(), people.member, async (tx) => (await tx.execute(sql`select public.bio_photo_operate(${people.tenant}::uuid, 'serve', ${ready}::uuid, ${JSON.stringify({ kind: "gallery" })}::jsonb) r`)).rows[0].r as { outcome: string })).outcome).toBe("not_found");
    // At most 60 gallery pictures in use per page: listed by a block of the draft or the published copy, or still uploading (last hour).
    const page = await getBioPage(db(), people.owner, people.tenant);
    await fixture.admin.query("update bio_files set retired_at=now() where page_id=$1 and kind='gallery'", [page.id]);
    const sixty: string[] = [];
    for (let i = 0; i < 60; i++) sixty.push(await galleryFile("ready"));
    const galleryBlock = (fileIds: string[]) => ({ type: "gallery" as const, id: "gallery2", hidden: false, tab: "home", title: "", fileIds });
    const draftWith = (lists: string[][]) => ({ ...page.draft, layout: "single" as const, blocks: [...lists.map((ids, n) => ({ ...galleryBlock(ids), id: `gallery${n + 2}` })), { type: "share" as const, id: "share001", hidden: false, tab: "home", title: "Share" }] });
    version = page.version;
    await save(people.owner, undefined, draftWith([0, 1, 2, 3, 4].map((n) => sixty.slice(n * 12, n * 12 + 12))));
    const newUpload = () => operate("create", randomUUID(), { kind: "gallery", name: "g.png", mime: "image/png", size: 10, checksum: "f".repeat(64) });
    expect((await newUpload()).outcome).toBe("invalid");
    // Removed from every block (and never published): they no longer count, so one more upload is accepted.
    await save(people.owner, undefined, draftWith([[sixty[0]]]));
    expect((await newUpload()).outcome).toBe("ok");
    // Uploads still waiting for their upload or scan count for an hour.
    await fixture.admin.query("update bio_files set retired_at=now() where page_id=$1 and kind='gallery' and status='ready' and id <> $2", [page.id, sixty[0]]);
    for (let i = 0; i < 58; i++) await galleryFile("pending");
    expect((await newUpload()).outcome).toBe("invalid");
    await fixture.admin.query("update bio_files set created_at=now() - interval '2 hours' where page_id=$1 and kind='gallery' and status='pending'", [page.id]);
    expect((await newUpload()).outcome).toBe("ok");
  });
  it("draws the QR code of a published page only", async () => {
    const { bioPageQr } = await import("../../src/server/link-in-bio-qr");
    const { bioPageUrl } = await import("../../src/server/link-in-bio-qr");
    const env = { ...process.env, BETTER_AUTH_URL: "https://harvest.example.invalid" };
    const svg = await bioPageQr(db(), "grace-church", "svg", env);
    expect(svg?.type).toBe("image/svg+xml"); expect(String(svg?.body)).toContain("<svg");
    expect((await bioPageQr(db(), "grace-church", "png", env))?.type).toBe("image/png");
    expect(await bioPageQr(db(), "no-such-page", "svg", env)).toBeNull();
    // The encoded address is the configured site's, never a request's Host header; without a site address there is no code.
    expect(bioPageUrl("grace-church", env)).toBe("https://harvest.example.invalid/l/grace-church");
    expect(await bioPageQr(db(), "grace-church", "svg", { ...env, BETTER_AUTH_URL: undefined })).toBeNull();
    expect((await getPublicBio(db(), "grace-church"))!.handle).toBe("grace-church");
  });
});
