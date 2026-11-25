import { describe, expect, it } from "vitest";
import { docToHtml, docToMarkdown, htmlToBlocks, markdownToBlocks, splitBlocks } from "../../src/lib/docs-convert";
import { docText, sanitizeDocContent, type DocContent, type DocNode } from "../../src/lib/docs";
import { docHighlightColors } from "../../src/lib/theme-registry";

const t = (text: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
const doc = (...content: DocNode[]): DocContent => ({ type: "doc", content });
const sample = doc(
  { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
  { type: "paragraph", content: [t("Hello "), t("bold", [{ type: "bold" }]), t(" and "), t("link", [{ type: "link", attrs: { href: "https://example.org/a" } }])] },
  { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [t("one")] }] }, { type: "listItem", content: [{ type: "paragraph", content: [t("two")] }] }] },
  { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [t("done")] }] }, { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [t("todo")] }] }] },
  { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [t("A")] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [t("B")] }] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [t("1")] }] }, { type: "tableCell", content: [{ type: "paragraph", content: [t("2")] }] }] }] },
  { type: "codeBlock", content: [t("let x = 1;")] }, { type: "blockquote", content: [{ type: "paragraph", content: [t("quoted")] }] }, { type: "horizontalRule" });

describe("export", () => {
  it("escapes every text and keeps only safe links and colours in HTML", () => {
    const evil = doc({ type: "paragraph", content: [t("<script>alert(1)</script>"), t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]), t("c", [{ type: "textStyle", attrs: { color: "red;background:url(x)" } }]), t("ok", [{ type: "link", attrs: { href: "https://example.org/?a=1&b=\"2\"" } }])] }, { type: "unknownBlock" });
    const html = docToHtml(evil);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("url(");
    expect(html).toContain('href="https://example.org/?a=1&amp;b=%222%22"');
  });
  it("writes Markdown for the supported blocks", () => {
    const md = docToMarkdown(sample);
    expect(md).toContain("# Title");
    expect(md).toContain("Hello **bold** and [link](https://example.org/a)");
    expect(md).toContain("- one\n- two");
    expect(md).toContain("- [x] done\n- [ ] todo");
    expect(md).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(md).toContain("```\nlet x = 1;\n```");
    expect(md).toContain("> quoted");
    expect(md).toContain("---");
  });
});

describe("import", () => {
  it("drops scripts, images, frames, handlers and unsafe links but keeps the text", () => {
    const blocks = htmlToBlocks('<html><body><h2 onclick="x()">Head</h2><p>Hi <a href="javascript:alert(1)">bad</a> <a href="http://x.test">http</a> <a href="https://ok.test/">ok</a></p><script>alert(1)</script><img src="https://x/y.png" onerror="x()"><iframe src="https://x"></iframe><style>p{color:red}</style></body></html>');
    const json = JSON.stringify(sanitizeDocContent({ type: "doc", content: blocks }));
    expect(json).toContain('"text":"Head"');
    expect(json).toContain('"text":"bad"');
    expect(json).not.toContain("alert");
    expect(json).not.toContain("onclick");
    expect(json).not.toContain("javascript");
    expect(json).not.toContain("http://");
    expect(json).toContain('"href":"https://ok.test/"');
  });
  it("reads lists, checklists, tables, quotes and code", () => {
    const blocks = htmlToBlocks("<ul><li>a</li><li>b</li></ul><ol><li>x</li></ol><ul><li><input type=checkbox checked> done</li><li>[ ] todo</li></ul><table><tr><th>H</th></tr><tr><td>c</td></tr></table><blockquote>q</blockquote><pre><code>code</code></pre>");
    expect(blocks.map((b) => b.type)).toEqual(["bulletList", "orderedList", "taskList", "table", "blockquote", "codeBlock"]);
    const tasks = blocks[2].content!;
    expect(tasks.map((i) => i.attrs?.checked)).toEqual([true, false]);
    expect(docText(tasks[0]).trim()).toBe("done");
    expect(docText(tasks[1]).trim()).toBe("todo");
    expect(() => sanitizeDocContent({ type: "doc", content: blocks })).not.toThrow();
  });
  it("reads Markdown (raw HTML in it is cleaned the same way)", () => {
    const blocks = markdownToBlocks("# Title\n\nSome **bold** text\n\n- [x] done\n- [ ] todo\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "taskList", "table"]);
    expect(JSON.stringify(blocks)).not.toContain("alert");
  });
  it("splits at top-level headings into pages, keeping text before the first one", () => {
    const blocks = htmlToBlocks("<p>Intro</p><h1>One</h1><p>a</p><h2>Sub</h2><p>b</p><h1>Two</h1><p>c</p>");
    const pages = splitBlocks(blocks, true, "Imported");
    expect(pages.map((p) => p.title)).toEqual(["Imported", "One", "Two"]);
    expect(docText(pages[1].content)).toContain("Sub");
    expect(splitBlocks(blocks, false, "Imported")).toHaveLength(1);
    expect(splitBlocks(htmlToBlocks("<p>x</p>"), true, "Imported")).toHaveLength(1);
  });
  it("refuses an oversized import", () => {
    expect(() => htmlToBlocks("x".repeat(1_000_001))).toThrow();
    expect(() => markdownToBlocks("x".repeat(1_000_001))).toThrow();
  });
});

describe("slice 2b nodes", () => {
  const doc = { type: "doc", content: [
    { type: "blockquote", attrs: { pull: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Grace" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Tag", marks: [{ type: "badge", attrs: { color: docHighlightColors[0], strong: true } }] }, { type: "text", text: " " }, { type: "mention", attrs: { kind: "person", id: "u1", label: "Ana" } }] },
    { type: "button", attrs: { label: "Give", href: "https://example.org/give" } },
    { type: "tableOfContents", attrs: { sticky: true } },
  ] };
  it("keeps the new nodes and marks through the sanitiser and drops unsafe values", () => {
    const clean = sanitizeDocContent(doc);
    expect(clean.content?.[0].attrs).toEqual({ pull: true });
    expect(clean.content?.[1].content?.[0].marks).toEqual([{ type: "badge", attrs: { color: docHighlightColors[0], strong: true } }]);
    expect(clean.content?.[3].attrs).toEqual({ sticky: true });
    const unsafe = sanitizeDocContent({ type: "doc", content: [{ type: "button", attrs: { label: "x", href: "javascript:alert(1)" } }, { type: "paragraph", content: [{ type: "text", text: "t", marks: [{ type: "badge", attrs: { color: "#123456" } }] }] }] });
    expect(unsafe.content?.[0].attrs).toEqual({ label: "x" });
    expect(unsafe.content?.[1].content?.[0].marks).toBeUndefined();
  });
  it("exports them as plain, escaped HTML and Markdown", () => {
    const html = docToHtml(doc as never);
    expect(html).toContain("<blockquote data-pull>");
    expect(html).toContain("@Ana");
    expect(html).toContain('<a data-button href="https://example.org/give"');
    expect(docToMarkdown(doc as never)).toContain("[Give](https://example.org/give)");
    expect(docToMarkdown(doc as never)).toContain("@Ana");
  });
});
