import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { buildPageTree, contentStats, docOutline, docRights, DocContentError, flattenTree, folderNameKey, reorder, resolvePageStyle, safeDocHref, sanitizeDocContent, subtreeIds } from "../../src/lib/docs";
import { docHref, docsHref, folderPath, folderSubtree } from "../../src/lib/docs-list";
import { can } from "../../src/lib/permissions";

const p = (text: string, marks?: object[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });

describe("docs content", () => {
  it("keeps https links only and refuses unknown node and mark types", () => {
    expect(safeDocHref("https://example.org/x")).toBe("https://example.org/x");
    for (const bad of ["http://example.org", "javascript:alert(1)", "https://a:b@example.org", "//example.org", "", 5]) expect(safeDocHref(bad)).toBeNull();
    const clean = sanitizeDocContent({ type: "doc", content: [p("a", [{ type: "link", attrs: { href: "http://x.test" } }, { type: "bold" }])] });
    expect(JSON.stringify(clean)).toBe('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a","marks":[{"type":"bold"}]}]}]}');
    expect(() => sanitizeDocContent({ type: "doc", content: [{ type: "script" }] })).toThrow(DocContentError);
    expect(() => sanitizeDocContent({ type: "doc", content: [p("a", [{ type: "evil" }])] })).toThrow(DocContentError);
  });
  it("computes statistics and an outline from the content", () => {
    const doc = { type: "doc" as const, content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title here" }] }, p("one two three")] };
    expect(contentStats(doc)).toEqual({ words: 5, characters: 20, readingMinutes: 1 });
    expect(docOutline(doc)).toEqual([{ level: 2, text: "Title here" }]);
    expect(contentStats({ type: "doc" }).readingMinutes).toBe(0);
  });
});

describe("docs tree and rules", () => {
  const pages = [
    { id: "a", parentId: null, position: 0, title: "A", icon: null, archivedAt: null, protected: false },
    { id: "b", parentId: "a", position: 1, title: "B", icon: null, archivedAt: null, protected: false },
    { id: "c", parentId: "a", position: 0, title: "C", icon: null, archivedAt: null, protected: false },
    { id: "d", parentId: null, position: 1, title: "D", icon: null, archivedAt: null, protected: false },
  ];
  it("orders, flattens and walks subtrees", () => {
    expect(flattenTree(buildPageTree(pages)).map((n) => [n.id, n.depth])).toEqual([["a", 0], ["c", 1], ["b", 1], ["d", 0]]);
    expect(subtreeIds(pages, "a").sort()).toEqual(["a", "b", "c"]);
    expect(reorder(["x", "y", "z"], "x", 2)).toEqual(["y", "z", "x"]);
    expect(reorder(["x", "y", "z"], "z", -3)).toEqual(["z", "x", "y"]);
  });
  it("applies the role rule", () => {
    expect(docRights("viewer", "u", "u")).toEqual({ manage: false, write: false });
    expect(docRights("member", "u", "u").write).toBe(true);
    expect(docRights("member", "x", "u").write).toBe(false);
    expect(docRights("admin", "x", "u")).toEqual({ manage: true, write: true });
    expect(["owner", "admin", "member", "viewer"].map((r) => can(r, "docs:read"))).toEqual([true, true, true, true]);
    expect(["owner", "admin", "member", "viewer"].map((r) => can(r, "docs:write"))).toEqual([true, true, true, false]);
    expect(["owner", "admin", "member", "viewer"].map((r) => can(r, "docs:manage"))).toEqual([true, true, false, false]);
  });
  it("resolves page style defaults and folder helpers", () => {
    expect(resolvePageStyle({ font: "mono" })).toMatchObject({ font: "mono", size: "default", width: "default", header: { owner: true } });
    const folders = [{ id: "1", parentId: null, name: "A" }, { id: "2", parentId: "1", name: "B" }, { id: "3", parentId: "2", name: "C" }];
    expect(folderPath(folders, "3").map((f) => f.name)).toEqual(["A", "B", "C"]);
    expect(folderSubtree(folders, "1").sort()).toEqual(["1", "2", "3"]);
    expect(folderNameKey("  Sermons ")).toBe(folderNameKey("SERMONS"));
    expect(docsHref("t", { folder: "1", q: "x", status: "trash" })).toBe("/workspaces/t/docs?folder=1&q=x&status=trash");
    expect(docHref("t", "d", "p")).toBe("/workspaces/t/docs/d?page=p");
  });
});

describe("docs message catalogue", () => {
  it("has every key the Docs components use", () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const f = join(dir, name); if (statSync(f).isDirectory()) walk(f); else if (/\.tsx?$/.test(f)) files.push(f); } };
    walk("src/components/docs");
    const missing: string[] = [];
    const lookup = (path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [, name, namespace] of source.matchAll(/(\w+)\s*=\s*useTranslations\("([^"]+)"\)/g)) {
        for (const m of source.matchAll(new RegExp(`\\b${name}\\(\\s*"([^"$]+)"`, "g"))) if (lookup(`${namespace}.${m[1]}`) === undefined) missing.push(`${file}: ${namespace}.${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
    // Dynamic keys: every slash item, colour, style option and toolbar heading resolves.
    const dynamic = ["slash.h1", "slash.suggestTable", "slash.toc", "slash.color-red", "slash.highlight-gray", "colorName.pink", "styles.font.serif", "styles.size.large", "styles.width.wide", "toolbar.h4", "toolbar.align-justify", "slashSection.highlights"];
    for (const key of dynamic) expect(lookup(`Docs.${key}`), key).toBeTypeOf("string");
  });
  it("uses provider-neutral copy", () => {
    expect(JSON.stringify((messages as Record<string, unknown>).Docs)).not.toMatch(/clickup|notion|google|microsoft|word\b/i);
  });
});
