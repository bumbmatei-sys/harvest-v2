import { readFileSync } from "node:fs";
import { parseDocument } from "htmlparser2";
import { describe, expect, it } from "vitest";
import { blogHandleProblem, blogImageIds, blogReservedHandles, blogSlugProblem, clip, derivedExcerpt, publishProblems, rssDocument, sanitizeBlogBody, searchPreview, slugFromTitle } from "../../src/lib/blog";
import { docToHtml } from "../../src/lib/docs-convert";
import { DocContentError } from "../../src/lib/docs";
import { bioReservedHandles } from "../../src/lib/link-in-bio";
import { permissionArea } from "../../src/lib/access-areas";
import { can } from "../../src/lib/permissions";
import { navEntries } from "../../src/lib/navigation";
import { blogEnabled, blogPublishWorkerEnabled } from "../../src/server/blog-mode";

const migration = readFileSync("drizzle/0135_native_blog.sql", "utf8");
const picture = "7d2b9c1e-3f4a-4b5c-8d6e-9f0a1b2c3d4e";

describe("addresses", () => {
  it("applies the handle rules and keeps the reserved words in step with the database check", () => {
    expect(blogHandleProblem("grace-church")).toBeNull();
    expect([blogHandleProblem("ab"), blogHandleProblem("Grace"), blogHandleProblem("a--b"), blogHandleProblem("-ab"), blogHandleProblem("rss"), blogHandleProblem("communities")])
      .toEqual(["length", "characters", "characters", "characters", "reserved", "reserved"]);
    expect(blogReservedHandles).toEqual(expect.arrayContaining([...bioReservedHandles, "blog", "rss", "feed", "images"]));
    const check = /CONSTRAINT "blog_settings_handle" CHECK \((.*)\),\n/.exec(migration)?.[1] ?? "";
    for (const word of blogReservedHandles) expect(check, word).toContain(`'${word}'`);
  });

  it("applies the article address rules, derives an address from a title and never collides with the feed or picture routes", () => {
    expect(blogSlugProblem("advent-hope")).toBeNull();
    expect(blogSlugProblem("a")).toBeNull();
    expect([blogSlugProblem(""), blogSlugProblem("x".repeat(81)), blogSlugProblem("Hope!"), blogSlugProblem("rss"), blogSlugProblem("images")]).toEqual(["length", "length", "characters", "reserved", "reserved"]);
    expect(slugFromTitle("  Ça va? Advent — Hope & Peace!  ")).toBe("ca-va-advent-hope-peace");
    expect(slugFromTitle("!!!")).toBe("");
    expect(migration).toContain(`"blog_posts"."slug" not in ('rss', 'feed', 'images', 'page')`);
  });
});

describe("body", () => {
  it("keeps Docs blocks and the picture node, refuses unknown nodes and a picture without a file", () => {
    const body = sanitizeBlogBody({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      { type: "blogImage", attrs: { fileId: picture.toUpperCase(), alt: " Candles ", onload: "x" } }, { type: "blogImage", attrs: { fileId: picture } }] });
    expect(body.content?.[1]).toEqual({ type: "blogImage", attrs: { fileId: picture, alt: "Candles" } });
    expect(blogImageIds(body)).toEqual([picture]);
    expect(() => sanitizeBlogBody({ type: "doc", content: [{ type: "image", attrs: { src: "https://example.invalid/x.png" } }] })).toThrow(DocContentError);
    expect(() => sanitizeBlogBody({ type: "doc", content: [{ type: "blogImage", attrs: { fileId: "not-a-uuid" } }] })).toThrow();
    expect(() => sanitizeBlogBody({ type: "doc", content: Array.from({ length: 51 }, () => ({ type: "blogImage", attrs: { fileId: crypto.randomUUID() } })) })).toThrow();
  });

  it("renders pictures only through the given address and escapes everything", () => {
    const html = docToHtml({ type: "doc", content: [{ type: "blogImage", attrs: { fileId: picture, alt: `"><script>x</script>` } }, { type: "paragraph", content: [{ type: "text", text: "<b>hi</b>" }] }] },
      { image: (id) => `/blog/grace/images/${id}` });
    expect(html).toContain(`<img src="/blog/grace/images/${picture}" alt="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"`);
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(docToHtml({ type: "doc", content: [{ type: "blogImage", attrs: { fileId: picture } }] })).toBe("");
  });

  it("asks for a title, an address and text before publishing", () => {
    expect(publishProblems({ title: " ", slug: "x", body: { type: "doc", content: [{ type: "paragraph" }] } })).toEqual(["title", "body"]);
    expect(publishProblems({ title: "Hope", slug: "hope", body: { type: "doc", content: [{ type: "blogImage", attrs: { fileId: picture } }] } })).toEqual([]);
  });
});

describe("previews and feed", () => {
  it("clips at a word and falls back from SEO fields to the title and excerpt", () => {
    expect(clip("one two three four five", 16)).toBe("one two three…");
    expect(clip("short", 16)).toBe("short");
    expect(derivedExcerpt("  Own  excerpt ", null)).toBe("Own excerpt");
    expect(derivedExcerpt(null, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "From the body." }] }] })).toBe("From the body.");
    expect(searchPreview({ title: "Advent hope", seoTitle: null, seoDescription: null, excerpt: "Waiting.", url: "https://example.invalid/blog/grace/advent-hope" }))
      .toEqual({ title: "Advent hope", url: "example.invalid › blog › grace › advent-hope", description: "Waiting." });
    expect(searchPreview({ title: "x", seoTitle: "y".repeat(80), seoDescription: "z ".repeat(100), url: "https://example.invalid/" }).title.length).toBeLessThanOrEqual(60);
  });

  it("builds a well-formed RSS 2.0 document with escaped values", () => {
    const xml = rssDocument({ title: "Grace & Peace <Blog>", description: null, link: "https://example.invalid/blog/grace", self: "https://example.invalid/blog/grace/rss.xml",
      updatedAt: "2026-11-27T10:00:00.000Z", items: [{ title: `"Hope" & 'joy'`, link: "https://example.invalid/blog/grace/hope", description: "A <short> note\u0001", publishedAt: "2026-11-26T09:00:00.000Z", html: "<p>Hi &amp; bye</p>" }] });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<title>Grace &amp; Peace &lt;Blog&gt;</title>");
    expect(xml).toContain("<pubDate>Thu, 26 Nov 2026 09:00:00 GMT</pubDate>");
    expect(xml).toContain("<content:encoded>&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;</content:encoded>");
    expect(xml).not.toContain("\u0001");
    const doc = parseDocument(xml, { xmlMode: true });
    const find = (name: string) => { const out: unknown[] = []; const walk = (n: { name?: string; children?: unknown[] }) => { if (n.name === name) out.push(n); (n.children ?? []).forEach((c) => walk(c as never)); }; walk(doc as never); return out; };
    expect(find("rss")).toHaveLength(1);
    expect(find("channel")).toHaveLength(1);
    expect(find("item")).toHaveLength(1);
    expect(find("atom:link")).toHaveLength(1);
    // Balanced: every opening tag of the document closes (a well-formedness check without a validating parser).
    const opens = (xml.match(/<(?!\?|\/)[a-z:]+[^>]*[^/]>/gi) ?? []).length, closes = (xml.match(/<\/[a-z:]+>/gi) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe("access and gates", () => {
  it("is owner/admin capability in the Website area, with a navigation entry behind the module gate", () => {
    expect(permissionArea["blog:manage"]).toBe("website");
    expect([can("owner", "blog:manage"), can("admin", "blog:manage"), can("member", "blog:manage"), can("viewer", "blog:manage"), can("guest", "blog:manage")]).toEqual([true, true, false, false, false]);
    expect([can("collaborator;website=manage", "blog:manage"), can("collaborator;website=view", "blog:manage"), can("collaborator;social=manage", "blog:manage")]).toEqual([true, false, false]);
    const entry = navEntries.find((e) => e.id === "articles")!;
    expect(entry).toMatchObject({ group: "website", mode: "public", path: "/blog", permission: "blog:manage", feature: "blog" });
    expect(entry.status).toBeUndefined();
  });

  it("keeps the module and the scheduled-publish job off in production, and the job off unless switched on", () => {
    expect(blogEnabled({ NODE_ENV: "development" })).toBe(true);
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "development", VERCEL_ENV: "production" }, { NODE_ENV: "development", HARVEST_ENV: "production" }]) expect(blogEnabled(env)).toBe(false);
    expect(blogPublishWorkerEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(blogPublishWorkerEnabled({ NODE_ENV: "development", HARVEST_BLOG_PUBLISH_ENABLED: "1" })).toBe(true);
    expect(blogPublishWorkerEnabled({ NODE_ENV: "production", HARVEST_BLOG_PUBLISH_ENABLED: "1" })).toBe(false);
    expect(blogPublishWorkerEnabled({ NODE_ENV: "development", VERCEL_ENV: "production", HARVEST_BLOG_PUBLISH_ENABLED: "1" })).toBe(false);
  });

  it("writes every definer with a pinned search path, schema-qualified names, an explicit clear list and FORCE RLS", () => {
    const functions = [...migration.matchAll(/CREATE FUNCTION (public\.[a-z_]+)\([^)]*\)[^$]*?SET search_path = pg_catalog, pg_temp AS \$\$/g)].map((m) => m[1]);
    const created = [...migration.matchAll(/CREATE FUNCTION (public\.[a-z_]+)/g)].map((m) => m[1]);
    expect(functions.sort()).toEqual(created.sort());
    expect(created.length).toBeGreaterThanOrEqual(12);
    expect(migration).not.toMatch(/FROM\s+(pg_catalog\.)?pg_settings/i);
    expect(migration).toMatch(/ALTER TABLE public\.blog_posts FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/ALTER TABLE public\.blog_settings FORCE ROW LEVEL SECURITY/);
    // Every definer policy for the owner role reads a transaction-local flag; none is unconditional.
    for (const m of migration.matchAll(/CREATE POLICY blog_public_definer ON public\.[a-z_]+ FOR SELECT TO %I\s+USING \(([^$]*?)\)\$p\$/g)) expect(m[1]).toMatch(/current_setting|%s/);
    expect(migration).toMatch(/access_role\(m\.tenant_id, m\.user_id, 'website', m\.role_id\)/);
  });
});
