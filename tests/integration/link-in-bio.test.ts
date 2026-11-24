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
    const published = await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    expect(published.status).toBe("published");
    const view = (await getPublicBio(db(), "grace-church"))!;
    expect(view).toMatchObject({ name: "Grace Church", ministryName: "bio ministry", hasPhoto: false });
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
    expect(await bioChoices(db(), people.owner, people.tenant)).toEqual({ communities: [], signups: [] });
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
  it("shows only the details the owner entered and left visible, and no hidden tab or its blocks", async () => {
    version = (await getBioPage(db(), people.owner, people.tenant)).version;
    const detail = (id: string, kind: "location" | "role", value: string, hidden: boolean) => ({ id, kind, value, hidden });
    const definition: BioDefinition = { ...def([link("aaaaaaaa"), message]), details: [detail("dddddd01", "location", "Lisbon", false), detail("dddddd02", "role", "Pastor", true)],
      tabs: [{ id: "home", hidden: false }, { id: "partnership", hidden: false }] };
    await save(people.owner, undefined, definition);
    await transitionBioPage(db(), people.owner, people.tenant, { action: "publish", version });
    const open = (await getPublicBio(db(), "grace-church"))!;
    expect(open.details).toEqual([{ id: "dddddd01", kind: "location", value: "Lisbon" }]);
    expect(JSON.stringify(open)).not.toContain("Pastor");
    expect((await respondToBioProof(request("/l/grace-church/message"), ctx("grace-church"))).status).toBe(200);
    await save(people.owner, undefined, { ...definition, tabs: [{ id: "partnership", hidden: true }, { id: "home", hidden: false }] });
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
});
