import { describe, expect, it } from "vitest";
import { blockTypes, defaultBrand, emailDocumentSchema, httpsUrl, moveBlock, newBlock, type EmailDocument } from "@/lib/email/blocks";
import { inboxCheck, inboxReady } from "@/lib/email/inbox-check";
import { onColor, renderEmail } from "@/lib/email/render";
import { templateDocument, templateIds } from "@/lib/email/templates";

const context = { unsubscribe: "https://newsletter.example.test/unsubscribe?t=1", ministryName: "Grace Church", firstName: "Ana", preheader: "Short preview" };
const brand = { ...defaultBrand, address: "1 Main Street, Springfield" };
const doc = (blocks: EmailDocument["blocks"]): EmailDocument => ({ version: 2, brand, blocks });
const render = (blocks: EmailDocument["blocks"], extra = {}) => renderEmail(doc(blocks), { ...context, ...extra });

describe("email renderer", () => {
  it("renders every block type with the compliance footer and a plain-text alternative", () => {
    const copy = { title: "T", heading: "H", text: "Body", button: "Go", cite: "C", date: "D", time: "9", location: "L", caption: "Cap", leftHeading: "a", leftText: "b", rightHeading: "c", rightText: "d", linkOne: "One", linkTwo: "Two", note: "N" };
    for (const type of blockTypes) {
      const block = newBlock(type, copy, "id-" + type);
      const out = render([block]);
      expect(out.html).toContain('width="600"');
      expect(out.html).toContain("Unsubscribe");
      expect(out.html).toContain("1 Main Street, Springfield");
      expect(out.text).toContain("Unsubscribe: https://newsletter.example.test/unsubscribe?t=1");
      expect(out.text).toContain("1 Main Street, Springfield");
      expect(out.headers["List-Unsubscribe"]).toContain("https://newsletter.example.test");
    }
  });

  it("escapes user text and never emits user-controlled markup", () => {
    const hostile = '<script>alert(1)</script>"><img src=x onerror=1>';
    const blocks = [
      { id: "b-hero", type: "hero", imageUrl: "", alt: "", heading: hostile, text: hostile, buttonLabel: hostile, buttonUrl: "https://example.com/?a=1&b=\"2\"" },
      { id: "b-quote", type: "quote", text: hostile, cite: hostile },
      { id: "b-cols", type: "columns", leftHeading: hostile, leftText: hostile, rightHeading: hostile, rightText: hostile },
      { id: "b-foot", type: "footer", note: hostile },
    ] as EmailDocument["blocks"];
    const out = render(blocks, { ministryName: hostile });
    expect(out.html).not.toContain("<script");
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("a=1&amp;b=%222%22");
  });

  it("uses Outlook-safe button markup", () => {
    const out = render([{ id: "b-give", type: "giving", heading: "Give", text: "", buttonLabel: "Give now", buttonUrl: "https://example.com/give" }]);
    expect(out.html).toContain("<!--[if mso]><v:roundrect");
    expect(out.html).toContain("<w:anchorlock/>");
    expect(out.html).toContain('<!--[if !mso]><!--><a href="https://example.com/give"');
    expect(out.html).toContain("<!--<![endif]-->");
    expect(out.text).toContain("Give now: https://example.com/give");
  });

  it("allows https links and images only", () => {
    expect(httpsUrl("http://example.com")).toBeNull();
    expect(httpsUrl("javascript:alert(1)")).toBeNull();
    expect(httpsUrl("https://user:pw@example.com")).toBeNull();
    const bad = { id: "b-hero", type: "hero", imageUrl: "http://example.com/a.png", alt: "x", heading: "H", text: "", buttonLabel: "Go", buttonUrl: "javascript:alert(1)" } as EmailDocument["blocks"][number];
    const out = render([bad]);
    expect(out.html).not.toContain("http://example.com");
    expect(out.html).not.toContain("javascript:");
    expect(emailDocumentSchema.safeParse({ version: 2, brand, blocks: [bad] }).success).toBe(false);
    const fixed = { ...bad, imageUrl: "https://example.com/a.png", buttonUrl: "https://example.com/go" } as EmailDocument["blocks"][number];
    const ok = emailDocumentSchema.safeParse({ version: 2, brand, blocks: [fixed] });
    expect(ok.success).toBe(true);
    expect(render([fixed]).html).toContain('alt="x"');
  });

  it("always appends the footer, even when the document has none and no address is set", () => {
    const out = renderEmail({ version: 2, brand: defaultBrand, blocks: [{ id: "b-div", type: "divider" }] }, context);
    expect(out.html).toContain("Unsubscribe");
    expect(out.html).toContain("Mailing address not set");
    expect(() => renderEmail(doc([{ id: "b-div", type: "divider" }]), { ...context, unsubscribe: "http://insecure.test" })).toThrow();
  });

  it("merges fields with fallbacks and applies brand tokens", () => {
    const out = renderEmail(doc([{ id: "b-text", type: "text", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello {{firstName}} from {{ministryName}}" }] }] } }]), { unsubscribe: context.unsubscribe });
    expect(out.html).toContain("Hello friend from our ministry");
    const branded = renderEmail({ version: 2, brand: { ...brand, primary: "#112233", font: "verdana", buttonRadius: "pill" }, blocks: [newBlock("hero", { button: "Go", heading: "H" }, "b-hero")] }, context);
    expect(branded.html).toContain("#112233");
    expect(branded.html).toContain("Verdana");
    expect(onColor("#112233")).toBe("#ffffff");
    expect(onColor("#f4f1ea")).toBe("#1a1a1a");
  });

  it("drops unsupported text formats instead of rejecting the document", () => {
    const parsed = emailDocumentSchema.parse({ version: 2, brand, blocks: [{ id: "b-text", type: "text", doc: { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "kept", marks: [{ type: "bold" }, { type: "strike" }, { type: "link", attrs: { href: "https://example.com" } }] }] }] } }] });
    const out = renderEmail(parsed, context);
    expect(out.html).toContain("<strong>kept</strong>");
    expect(out.html).not.toContain("<s>");
    expect(out.text).toContain("kept (https://example.com/)");
  });

  it("moves blocks", () => expect(moveBlock([1, 2, 3], 0, 2)).toEqual([2, 3, 1]));
});

describe("inbox check", () => {
  it("flags the deterministic problems", () => {
    const hero = newBlock("hero", { heading: "H", button: "Go" }, "b-hero");
    const bad = inboxCheck({ subject: "", preheader: "", doc: { version: 2, brand: defaultBrand, blocks: [hero] } });
    const level = (id: string) => bad.find(check => check.id === id)?.level;
    expect(level("subject")).toBe("fail");
    expect(level("preview")).toBe("warn");
    expect(level("address")).toBe("fail");
    expect(level("links")).toBe("fail");
    expect(inboxReady(bad)).toBe(false);
    const withImage = { ...hero, imageUrl: "https://example.com/a.png", buttonUrl: "https://example.com", alt: "" } as typeof hero;
    const good = inboxCheck({ subject: "A fine subject", preheader: "p", doc: { version: 2, brand, blocks: [withImage] } });
    expect(good.find(check => check.id === "imageAlt")).toMatchObject({ level: "warn", count: 1 });
    expect(inboxReady(good)).toBe(true);
    expect(inboxCheck({ subject: "x".repeat(70), preheader: "p", doc: doc([withImage]) }).find(check => check.id === "subject")?.level).toBe("warn");
  });
});

describe("starter templates", () => {
  it("ships eight templates that validate, render and pass the inbox check", () => {
    expect(templateIds).toHaveLength(8);
    for (const id of templateIds) {
      const template = templateDocument(id, brand);
      expect(emailDocumentSchema.safeParse(template).success, id).toBe(true);
      const html = renderEmail(template, context);
      expect(html.html, id).toContain("Unsubscribe");
      expect(html.text.length, id).toBeGreaterThan(80);
      const checks = inboxCheck({ subject: "Subject", preheader: "Preview", doc: template });
      // Buttons need a destination before sending; that is the only expected failure on a fresh template.
      expect(checks.filter(check => check.level === "fail" && check.id !== "links"), id).toEqual([]);
      expect(new Set(template.blocks.map(block => block.id)).size).toBe(template.blocks.length);
    }
  });
});
