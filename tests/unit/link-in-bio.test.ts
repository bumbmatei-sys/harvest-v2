import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bioBlockSchema, bioDefinitionSchema, bioLimits, bioReservedHandles, blockShown, emptyBioDefinition, fieldIssues, handleProblem, isLegacyTabId, messageNotice, moveItem, newBlockId,
  publishIssues, shownTabs, oneLine, bioClickTypes, mapsHref, telHref, whatsappHref, safeHttpsUrl, suggestHandle, bioMessageSchema } from "../../src/lib/link-in-bio";
import { BIO_MESSAGES_PRODUCTION_ENABLED, bioMessagesKey, linkInBioEnabled } from "../../src/server/link-in-bio-mode";
import { bioVisitorKey } from "../../src/server/link-in-bio-public";
import { issueBioProof } from "../../src/server/link-in-bio";
import { navEntries } from "../../src/lib/navigation";
import { can } from "../../src/lib/permissions";

const link = (over: Record<string, unknown> = {}) => ({ type: "link", id: "abcd1234", hidden: false, tab: "home", label: "Give", url: "https://example.org/give", icon: null, ...over });

describe("handles", () => {
  it("accepts 3 to 30 lower-case letters, digits and single hyphens", () => {
    for (const ok of ["abc", "grace-church", "a1b", "x".repeat(30)]) expect(handleProblem(ok)).toBeNull();
    expect(handleProblem("ab")).toBe("length"); expect(handleProblem("x".repeat(31))).toBe("length");
    for (const bad of ["Grace", "grace church", "-grace", "grace-", "gr--ace", "gr_ace", "grâce"]) expect(handleProblem(bad)).toBe("characters");
  });
  it("refuses every reserved word, including route names", () => {
    for (const word of bioReservedHandles.filter((w) => w.length >= 3 || true)) expect(handleProblem(word)).not.toBeNull();
    for (const route of ["admin", "api", "sign-in", "communities", "subscribe", "workspaces"]) expect(handleProblem(route)).toBe("reserved");
  });
  it("keeps the database function's reserved list in step", () => {
    const sql = readFileSync("drizzle/0094_link_in_bio.sql", "utf8").match(/NOT IN \(([^)]*)\)/)![1].match(/'([^']+)'/g)!.map((w) => w.slice(1, -1));
    expect([...sql].sort()).toEqual([...bioReservedHandles].sort());
  });
  it("suggests a usable handle from a ministry name", () => {
    expect(suggestHandle("Grace Community Church")).toBe("grace-community-church");
    expect(suggestHandle("Église Saint-Jean !!")).toBe("eglise-saint-jean");
    expect(suggestHandle("Admin")).toBe(""); expect(suggestHandle("??")).toBe("");
  });
});

describe("links", () => {
  it("accepts https addresses and normalises them", () => {
    expect(safeHttpsUrl(" https://Example.org/Give?x=1 ")).toBe("https://example.org/Give?x=1");
  });
  it("rejects other schemes, credentials, control characters and bare hosts", () => {
    for (const bad of ["http://example.org", "javascript:alert(1)", "data:text/html,hi", "https://user:pw@example.org", "https://localhost", "https://exa mple.org", "https://example.org/\u0007", "//example.org", "", "https://" + "a".repeat(2100) + ".org"]) expect(safeHttpsUrl(bad)).toBeNull();
  });
});

describe("definition", () => {
  const base = { ...emptyBioDefinition("Grace Church"), blocks: [link()] };
  it("accepts the five block types and normalises text", () => {
    const parsed = bioDefinitionSchema.parse({ ...base, name: "  Grace  ", blocks: [link(), { type: "message", id: "msg00001", hidden: false, title: "Message me" }, { type: "event", id: "evt00001", hidden: true, title: "Easter", when: "Sunday 10:00", url: "https://example.org/e" },
      { type: "community", id: "com00001", hidden: false, communityId: "11111111-1111-4111-8111-111111111111" }, { type: "newsletter", id: "new00001", hidden: false, slug: "news-letter" }] });
    expect(parsed.name).toBe("Grace"); expect(parsed.blocks).toHaveLength(5);
  });
  it("rejects unknown block types, extra keys, HTML angle brackets, duplicate ids, a second message block and too many items", () => {
    expect(bioBlockSchema.safeParse({ type: "script", id: "abcd1234", hidden: false }).success).toBe(false);
    expect(bioBlockSchema.safeParse(link({ extra: 1 })).success).toBe(false);
    expect(bioBlockSchema.safeParse(link({ label: "<b>x</b>" })).success).toBe(false);
    expect(bioBlockSchema.safeParse(link({ url: "http://example.org" })).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, blocks: [link(), link()] }).success).toBe(false);
    const message = (id: string) => ({ type: "message", id, hidden: false, title: "Hi" });
    expect(bioDefinitionSchema.safeParse({ ...base, blocks: [message("aaaaaaaa"), message("bbbbbbbb")] }).success).toBe(false);
    const many = Array.from({ length: bioLimits.blocks + 1 }, (_, i) => link({ id: `id${String(i).padStart(6, "0")}` }));
    expect(bioDefinitionSchema.safeParse({ ...base, blocks: many }).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, bio: "x".repeat(501) }).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, socials: [{ network: "x", url: "https://example.org" }, { network: "x", url: "https://example.org" }] }).success).toBe(false);
  });
  it("reports per-field problems and publish blockers", () => {
    const draft = { ...base, blocks: [{ ...(link() as object), url: "nope" }] } as unknown as ReturnType<typeof emptyBioDefinition>;
    expect(fieldIssues(draft)).toEqual({ abcd1234: "url" });
    expect(publishIssues({ ...emptyBioDefinition(""), blocks: [] }, { hasPhoto: true })).toEqual(["name", "empty"]);
    expect(publishIssues(bioDefinitionSchema.parse({ ...base, blocks: [link({ hidden: true })] }), { hasPhoto: true })).toEqual(["empty"]);
    // The profile photo is required (founder decision 25 Nov).
    expect(publishIssues(bioDefinitionSchema.parse(base), { hasPhoto: false })).toEqual(["photo"]);
    expect(publishIssues(bioDefinitionSchema.parse(base), { hasPhoto: true })).toEqual([]);
  });
  it("moves items like the drag and the buttons do", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]); expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0.5]; let n = 0;
    expect(newBlockId(["aaaaaaaa"], () => values[n++ % 9] ?? 0.5)).not.toBe("aaaaaaaa");
  });
});

describe("header and tabs (rework, 25 Nov)", () => {
  const base = { ...emptyBioDefinition("Grace Church"), blocks: [link()] };
  const tab = (id: string, label = "", hidden = false) => ({ id, label, hidden });
  it("fills the new fields of a page saved before the rework", () => {
    const old = { kind: "bio-v1", name: "Grace", subtitle: "", bio: "", details: [], tabs: [{ id: "home", hidden: false }, { id: "partnership", hidden: false }], scheme: "auto", buttons: "filled", socials: [], blocks: [link()] };
    const parsed = bioDefinitionSchema.parse(old);
    expect(parsed).toMatchObject({ layout: "tabs", cover: true, photoAlign: "center", iconStyle: "outline" });
    expect(parsed.tabs).toEqual([tab("home"), tab("partnership")]);
    expect(fieldIssues(parsed)).toEqual({});
  });
  it("takes up to six tabs with eight-character or original ids, unique and named", () => {
    const six = ["home", "abcdefgh", "ijklmnop", "qrstuvwx", "yz012345", "6789abcd"].map((id) => tab(id, "Tab"));
    expect(bioDefinitionSchema.safeParse({ ...base, tabs: six }).success).toBe(true);
    expect(bioDefinitionSchema.safeParse({ ...base, tabs: [...six, tab("zzzzzzzz", "Seven")] }).success).toBe(false);
    for (const bad of ["Home", "abc", "has space", "ABCDEFGH", "toolongid"]) expect(bioDefinitionSchema.safeParse({ ...base, tabs: [tab(bad, "x")] }).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, tabs: [tab("home"), tab("home")] }).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, tabs: [tab("abcdefgh", "x".repeat(bioLimits.tabLabel + 1))] }).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, tabs: [tab("abcdefgh", "<b>")] }).success).toBe(false);
    expect(bioDefinitionSchema.safeParse({ ...base, blocks: [link({ tab: "Bad tab" })] }).success).toBe(false);
    // A tab the owner added needs a name; the two original tabs keep their default names.
    const parsed = bioDefinitionSchema.parse({ ...base, tabs: [tab("home"), tab("abcdefgh", "  ")] });
    expect(fieldIssues(parsed)).toEqual({ "tab:abcdefgh": "required" });
    expect(fieldIssues({ ...parsed, layout: "single" })).toEqual({});
  });
  it("keeps one line of short bio, takes a subtitle as that line, and drops the details list (founder decision 27 Nov)", () => {
    expect(bioDefinitionSchema.parse({ ...base, bio: "  Line one \n line two " })).toMatchObject({ bio: "Line one", subtitle: "", details: [] });
    expect(bioDefinitionSchema.parse({ ...base, bio: "", subtitle: "Church planter" }).bio).toBe("Church planter");
    expect(bioDefinitionSchema.parse({ ...base, bio: "x".repeat(400) }).bio).toHaveLength(bioLimits.bioLine);
    expect(bioDefinitionSchema.parse({ ...base, details: [{ id: "dddddd01", kind: "location", value: "Lisbon", hidden: false }] }).details).toEqual([]);
    expect(oneLine("\n\n  a  \nb")).toBe("a");
  });
  it("accepts only the known layout, photo position and icon style", () => {
    for (const [key, ok, bad] of [["layout", "single", "grid"], ["photoAlign", "left", "right"], ["iconStyle", "color", "mono"], ["cover", false, "no"]] as const) {
      expect(bioDefinitionSchema.safeParse({ ...base, [key]: ok }).success).toBe(true);
      expect(bioDefinitionSchema.safeParse({ ...base, [key]: bad }).success).toBe(false);
    }
  });
  it("shows a block only on a shown tab, or always in the single-page layout", () => {
    const definition = bioDefinitionSchema.parse({ ...base, tabs: [tab("home"), tab("abcdefgh", "Give", true)] });
    const onHidden = link({ id: "bbbbbbbb", tab: "abcdefgh" }) as { hidden: boolean; tab: string }, onMissing = link({ id: "cccccccc", tab: "zzzzzzzz" }) as { hidden: boolean; tab: string };
    expect(blockShown(definition, link() as { hidden: boolean; tab: string })).toBe(true);
    expect(blockShown(definition, onHidden)).toBe(false);
    expect(blockShown(definition, onMissing)).toBe(false);
    expect(blockShown({ ...definition, layout: "single" }, onHidden)).toBe(true);
    expect(blockShown({ ...definition, layout: "single" }, { ...onHidden, hidden: true })).toBe(false);
    const blocks = [link({ id: "aaaaaaaa" }), onHidden, onMissing].map((b) => b as { id: string; hidden: boolean; tab: string });
    expect(shownTabs(definition, blocks).map((t) => [t.id, t.blocks.map((b) => b.id)])).toEqual([["home", ["aaaaaaaa"]]]);
    expect(shownTabs({ ...definition, layout: "single" }, blocks).map((t) => [t.label, t.blocks.map((b) => b.id)])).toEqual([["", ["aaaaaaaa", "bbbbbbbb", "cccccccc"]]]);
    expect(isLegacyTabId("home")).toBe(true); expect(isLegacyTabId("abcdefgh")).toBe(false);
  });
  it("keeps the database's block rule in step with the application's", () => {
    const sql = readFileSync("drizzle/0132_bio_tabs_layout.sql", "utf8");
    expect(sql).toMatch(/coalesce\(p_published->>'layout', 'tabs'\) = 'single'/);
    expect(sql).toMatch(/p_kind = 'cover' AND \(page\.published->>'cover'\) = 'false'/);
    expect(sql.split("\n").filter((line) => !line.startsWith("--")).join("\n")).not.toMatch(/SECURITY DEFINER/);
  });
});

describe("new block types (rework PR 2)", () => {
  const base = { ...emptyBioDefinition("Grace Church"), blocks: [link()] };
  const parse = (block: Record<string, unknown>) => bioDefinitionSchema.safeParse({ ...base, blocks: [{ id: "bbbbbbbb", hidden: false, tab: "home", ...block }] });
  const item = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  it("takes products and courses, and PDFs and ebooks, as lists of the ministry's item ids", () => {
    expect(parse({ type: "catalog", title: "", itemIds: [item, other] }).success).toBe(true);
    expect(parse({ type: "catalog", title: "", itemIds: [] }).success).toBe(false);
    expect(parse({ type: "catalog", title: "", itemIds: [item, item] }).success).toBe(false);
    expect(parse({ type: "catalog", title: "", itemIds: Array.from({ length: bioLimits.catalogItems + 1 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`) }).success).toBe(false);
    expect(parse({ type: "files", title: "Ebooks", itemIds: ["not-a-uuid"] }).success).toBe(false);
  });
  it("stores a video as provider and id only, from the course lessons' parser", () => {
    expect(parse({ type: "video", title: "", provider: "youtube", videoId: "dQw4w9WgXcQ" }).success).toBe(true);
    expect(parse({ type: "video", title: "", provider: "vk", videoId: "-1_2" }).success).toBe(true);
    expect(parse({ type: "video", title: "", provider: "youtube", videoId: "" }).success).toBe(false);
    expect(parse({ type: "video", title: "", provider: "vimeo", videoId: "123" }).success).toBe(false);
    expect(parse({ type: "video", title: "", provider: "youtube", videoId: "dQw4w9WgXcQ", url: "https://youtu.be/x" }).success).toBe(false);
    const draft = { ...base, blocks: [{ type: "video" as const, id: "bbbbbbbb", hidden: false, tab: "home", title: "", provider: "youtube" as const, videoId: "" }] };
    expect(fieldIssues(draft)).toEqual({ bbbbbbbb: "url" });
  });
  it("needs at least one valid contact channel", () => {
    expect(parse({ type: "contact", email: "hello@example.invalid", phone: "", whatsapp: "" }).success).toBe(true);
    expect(parse({ type: "contact", email: "", phone: "+351 912 345 678", whatsapp: "(212) 555-0100" }).success).toBe(true);
    expect(parse({ type: "contact", email: "", phone: "", whatsapp: "" }).success).toBe(false);
    for (const bad of [{ email: "nope" }, { phone: "call me" }, { phone: "12" }, { whatsapp: "+1 <script>" }]) expect(parse({ type: "contact", email: "", phone: "", whatsapp: "", ...bad }).success).toBe(false);
    expect(telHref("+351 912-345 678")).toBe("tel:+351912345678"); expect(whatsappHref("+351 (912) 345 678")).toBe("https://wa.me/351912345678");
  });
  it("opens maps by search, never embedding one, and keeps the address as text", () => {
    expect(parse({ type: "location", label: "", address: "Rua Augusta 1, Lisboa" }).success).toBe(true);
    expect(parse({ type: "location", label: "", address: "  " }).success).toBe(false);
    expect(parse({ type: "location", label: "", address: "<iframe>" }).success).toBe(false);
    expect(mapsHref(" Rua Augusta 1 & 2 ")).toBe("https://www.openstreetmap.org/search?query=Rua%20Augusta%201%20%26%202");
  });
  it("takes Live now as an https link with an on switch, and testimonials with a quote and a name", () => {
    expect(parse({ type: "live", title: "Sunday service", url: "https://example.org/live", on: true }).success).toBe(true);
    expect(parse({ type: "live", title: "Live", url: "http://example.org/live", on: true }).success).toBe(false);
    const quote = (id: string) => ({ id, quote: "It helped me.", name: "Ana", role: "" });
    expect(parse({ type: "testimonials", items: [quote("qqqqqqq1")] }).success).toBe(true);
    expect(parse({ type: "testimonials", items: [] }).success).toBe(false);
    expect(parse({ type: "testimonials", items: Array.from({ length: bioLimits.testimonials + 1 }, (_, i) => quote(`qqqqqqq${i}`)) }).success).toBe(false);
    expect(parse({ type: "testimonials", items: [{ ...quote("qqqqqqq1"), name: "" }] }).success).toBe(false);
    expect(parse({ type: "form", title: "Prayer request", slug: "prayer-request" }).success).toBe(true);
    expect(parse({ type: "form", title: "", slug: "prayer-request" }).success).toBe(false);
  });
  it("keeps the database's click list and catalog rule in step", () => {
    const sql = readFileSync("drizzle/0134_bio_blocks.sql", "utf8");
    const listed = sql.match(/b->>'type' IN \(([^)]*)\)\n\s*AND \(b->>'type' <> 'live'/)![1].match(/'([^']+)'/g)!.map((w) => w.slice(1, -1));
    expect(listed.sort()).toEqual([...bioClickTypes].sort());
    expect(sql).toMatch(/c\.state = 'published' AND c\.visibility <> 'hidden'/);
    expect(sql).toMatch(/'app\.catalog_slug','app\.catalog_tenant'\]/);
  });
});

describe("message me", () => {
  const ok = { proof: "x", name: "Ana", email: "ana@example.test", message: "Hello", consent: true };
  it("needs name, email, message and an explicit consent", () => {
    expect(bioMessageSchema.safeParse(ok).success).toBe(true);
    expect(bioMessageSchema.safeParse({ ...ok, consent: false }).success).toBe(false);
    expect(bioMessageSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(bioMessageSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
  it("uses the founder's fixed consent line", () => { expect(messageNotice("Grace Church")).toBe("Your details go to Grace Church. You can ask them to delete them."); });
  it("is hard-off in production and without the synthetic settings", () => {
    expect(BIO_MESSAGES_PRODUCTION_ENABLED).toBe(false);
    const env = { HARVEST_LINK_IN_BIO_MESSAGES: "synthetic", HARVEST_LINK_IN_BIO_MESSAGES_TEST_KEY: "ab".repeat(32), DATABASE_URL: "postgres://u:p@127.0.0.1:5432/harvest_test_x" };
    expect(bioMessagesKey(env)).not.toBeNull();
    expect(bioMessagesKey({ ...env, NODE_ENV: "production" })).toBeNull();
    expect(bioMessagesKey({ ...env, VERCEL_ENV: "production" })).toBeNull();
    expect(bioMessagesKey({ ...env, HARVEST_ENV: "production" })).toBeNull();
    expect(bioMessagesKey({ ...env, HARVEST_LINK_IN_BIO_MESSAGES: "on" })).toBeNull();
    expect(bioMessagesKey({ ...env, DATABASE_URL: "postgres://u:p@db.example.com/harvest_test_x" })).toBeNull();
    expect(bioMessagesKey({ ...env, DATABASE_URL: "postgres://u:p@127.0.0.1/harvest" })).toBeNull();
    expect(bioMessagesKey({ ...env, HARVEST_LINK_IN_BIO_MESSAGES_TEST_KEY: "short" })).toBeNull();
    expect(linkInBioEnabled({ NODE_ENV: "production" })).toBe(false); expect(linkInBioEnabled({ NODE_ENV: "development" })).toBe(true);
  });
  it("derives a visitor key only from a configured address, never storing it raw", () => {
    const request = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.5" } });
    const key = bioVisitorKey(request, { BETTER_AUTH_SECRET: "s".repeat(32) });
    expect(key).toMatch(/^[a-f0-9]{64}$/); expect(key).not.toContain("203");
    expect(bioVisitorKey(request, {})).toBeNull();
    expect(bioVisitorKey(new Request("http://x/"), { BETTER_AUTH_SECRET: "s" })).toBeNull();
  });
  it("issues a proof of three parts that depends on the handle", () => {
    const key = Buffer.alloc(32, 7), proof = issueBioProof("grace", key, 1_700_000_000_000);
    expect(proof.split(".")).toHaveLength(3); expect(proof).not.toBe(issueBioProof("grace", key, 1_700_000_000_000));
  });
});

describe("navigation and permissions", () => {
  it("activates Link in bio in Public for owners and admins only", () => {
    const entry = navEntries.find((e) => e.id === "linkInBio")!;
    expect(entry.status).toBeUndefined(); expect(entry.mode).toBe("public"); expect(entry.permission).toBe("bio:manage"); expect(entry.feature).toBe("linkInBio");
    expect([can("owner", "bio:manage"), can("admin", "bio:manage"), can("member", "bio:manage"), can("viewer", "bio:manage")]).toEqual([true, true, false, false]);
  });
});
