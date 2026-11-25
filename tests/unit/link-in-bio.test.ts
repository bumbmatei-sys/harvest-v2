import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bioBlockSchema, bioDefinitionSchema, bioLimits, bioReservedHandles, emptyBioDefinition, fieldIssues, handleProblem, messageNotice, moveItem, newBlockId,
  publishIssues, safeHttpsUrl, suggestHandle, bioMessageSchema } from "../../src/lib/link-in-bio";
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
    expect(publishIssues({ ...emptyBioDefinition(""), blocks: [] })).toEqual(["name", "empty"]);
    expect(publishIssues(bioDefinitionSchema.parse({ ...base, blocks: [link({ hidden: true })] }))).toEqual(["empty"]);
  });
  it("moves items like the drag and the buttons do", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]); expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0.5]; let n = 0;
    expect(newBlockId(["aaaaaaaa"], () => values[n++ % 9] ?? 0.5)).not.toBe("aaaaaaaa");
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
