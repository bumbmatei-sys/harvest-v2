import { describe, expect, it } from "vitest";
import { plainText, sanitizeRichText } from "../../src/lib/rich-text";

const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("sanitizeRichText", () => {
  it("keeps allowed nodes and marks and drops unknown attributes", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2, id: "x" }, content: [text("Start here")] },
      { type: "paragraph", content: [text("Be "), text("kind", [{ type: "bold" }, { type: "italic" }]), { type: "hardBreak" }, text("always", [{ type: "strike" }, { type: "underline" }])] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("one")] }] }] },
      { type: "orderedList", attrs: { start: 3, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("two")] }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [text("quote", [{ type: "link", attrs: { href: "https://example.test/a", target: "_self", class: "x" } }])] }] },
      { type: "paragraph" },
    );
    expect(sanitizeRichText(input)).toEqual(doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Start here")] },
      { type: "paragraph", content: [text("Be "), text("kind", [{ type: "bold" }, { type: "italic" }]), { type: "hardBreak" }, text("always", [{ type: "strike" }, { type: "underline" }])] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("one")] }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("two")] }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [text("quote", [{ type: "link", attrs: { href: "https://example.test/a" } }])] }] },
      { type: "paragraph" },
    ));
  });
  it.each([
    ["an unknown node", doc({ type: "image", attrs: { src: "https://x" } })],
    ["an unknown mark", doc({ type: "paragraph", content: [text("x", [{ type: "code" }])] })],
    ["a script link", doc({ type: "paragraph", content: [text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])] })],
    ["a data link", doc({ type: "paragraph", content: [text("x", [{ type: "link", attrs: { href: "data:text/html,hi" } }])] })],
    ["a level-1 heading", doc({ type: "heading", attrs: { level: 1 }, content: [text("x")] })],
    ["a block inside a paragraph", doc({ type: "paragraph", content: [{ type: "paragraph" }] })],
    ["text outside a paragraph", doc(text("x"))],
    ["a non-doc root", { type: "paragraph" }],
    ["an empty document", doc()],
  ])("rejects %s", (_label, input) => { expect(sanitizeRichText(input)).toBeNull(); });
  it("rejects documents that are too deep or too long", () => {
    let deep: Record<string, unknown> = { type: "paragraph", content: [text("x")] };
    for (let i = 0; i < 14; i++) deep = { type: "blockquote", content: [deep] };
    expect(sanitizeRichText(doc(deep))).toBeNull();
    expect(sanitizeRichText(doc({ type: "paragraph", content: [text("x".repeat(20001))] }))).toBeNull();
  });
  it("accepts mailto and http links", () => {
    for (const href of ["mailto:pastor@example.test", "http://example.test"]) {
      expect(sanitizeRichText(doc({ type: "paragraph", content: [text("x", [{ type: "link", attrs: { href } }])] }))).not.toBeNull();
    }
  });
});

describe("plainText", () => {
  it("joins blocks with newlines and keeps list items", () => {
    expect(plainText(doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
      { type: "paragraph", content: [text("a"), { type: "hardBreak" }, text("b")] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("one")] }] }, { type: "listItem", content: [{ type: "paragraph", content: [text("two")] }] }] },
    ) as never)).toBe("Title\na\nb\none\ntwo");
  });
});
