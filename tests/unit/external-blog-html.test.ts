import { expect, it } from "vitest";
import { externalBlogPlatforms } from "../../src/lib/external-blog";
import { exportBlogHtml } from "../../src/server/external-blog-html";

const fileId = "bab4bde8-ec10-4e2f-8da1-31cbdd1cc30a";
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const image = { type: "blogImage", attrs: { fileId, alt: 'An "image"' } };
const document = { type: "doc", content: [
  { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "<Heading>" }] },
  { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [paragraph("One")] }] },
  { type: "blockquote", content: [paragraph("Quote"), image] },
  { type: "codeBlock", content: [{ type: "text", text: "x < y" }] },
  { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [paragraph("Cell")] }] }] },
  { type: "paragraph", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
  { type: "paragraph", content: [{ type: "text", text: "good", marks: [{ type: "link", attrs: { href: "https://example.invalid/?q=a&b=c" } }] }] },
  paragraph("https://youtu.be/3tmd-ClpJxA"),
  image,
] };

it.each(externalBlogPlatforms)("exports safe HTML and specific format warnings on %s", (platform) => {
  const out = exportBlogHtml(document, platform, () => "https://example.invalid/image");
  for (const text of ['<h3>&lt;Heading&gt;</h3>', '<ol start="3"><li><p>One</p></li></ol>', '<blockquote><p>Quote</p>',
    '<table><tbody><tr><th><p>Cell</p></th>', 'alt="An &quot;image&quot;"', 'q=a&amp;b=c', 'x &lt; y']) expect(out.bodyHtml).toContain(text);
  expect(out.bodyHtml).not.toContain("javascript:");
  expect(out.bodyHtml.includes("<iframe")).toBe(platform === "wordpress" || platform === "shopify");
  expect(out.warnings.includes("video_link")).toBe(platform === "wix" || platform === "webflow");
  expect(out.warnings.includes("code_block")).toBe(platform === "webflow");
  expect(out.warnings.includes("nested_image")).toBe(platform === "wix");
});

it("rejects non-HTTPS image sources and warns before dropping oversized Wix blocks", () => {
  const out = exportBlogHtml({ type: "doc", content: [image, paragraph("<".repeat(10_000))] }, "wix", () => "javascript:alert(1)");
  expect(out).toEqual({ bodyHtml: "", warnings: ["image_unavailable", "wix_block_limit"] });
});
