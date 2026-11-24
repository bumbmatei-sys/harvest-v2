import { describe, expect, it } from "vitest";
import { blockSchema, defaultBrand, documentFileIds, emailDocumentSchema, newBlock, type EmailDocument } from "@/lib/email/blocks";
import { inboxCheck } from "@/lib/email/inbox-check";
import { newsletterImageInput, newsletterImageProblem } from "@/lib/email/image-limits";
import { renderEmail } from "@/lib/email/render";
import { parseVideoLink, youtubeThumbnailUrl } from "@/lib/email/video";

const context = { unsubscribe: "https://newsletter.example.test/unsubscribe", ministryName: "Grace" };
const brand = { ...defaultBrand, address: "1 Main St" };
const doc = (blocks: EmailDocument["blocks"], cover?: EmailDocument["cover"]): EmailDocument => ({ version: 2, brand, ...(cover ? { cover } : {}), blocks });
const fileId = "3f1c1d44-1f0e-4f43-a5f1-0d9a9b1d6a11", other = "9b2c7e44-1f0e-4f43-a5f1-0d9a9b1d6a22";
const url = (id: string) => `https://newsletter.example.test/api/files/public/t/${id}`;

describe("video links", () => {
  it("recognises YouTube by exact host and extracts the id", () => {
    for (const link of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", "https://youtu.be/dQw4w9WgXcQ?si=x", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ"])
      expect(parseVideoLink(link)).toMatchObject({ kind: "youtube", id: "dQw4w9WgXcQ" });
    expect(youtubeThumbnailUrl("dQw4w9WgXcQ")).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
  it("recognises VK and treats everything else as a plain link", () => {
    expect(parseVideoLink("https://vk.com/video-123_456")?.kind).toBe("vk");
    expect(parseVideoLink("https://vkvideo.ru/video-1_2")?.kind).toBe("vk");
    expect(parseVideoLink("https://example.com/clip.mp4")?.kind).toBe("link");
    expect(parseVideoLink("https://www.youtube.com/watch?v=short")?.kind).toBe("link");
  });
  it("never trusts look-alike hosts and rejects non-https, credentials and junk", () => {
    expect(parseVideoLink("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")?.kind).toBe("link");
    expect(parseVideoLink("https://evil.test/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.kind).toBe("link");
    for (const bad of ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://user:pw@vk.com/video1_2", "javascript:alert(1)", "https://a b.test", "", "not a url"]) expect(parseVideoLink(bad)).toBeNull();
    expect(youtubeThumbnailUrl("../../x")).not.toContain("..");
  });
});

describe("upload limits", () => {
  const ok = { name: "a.png", mime: "image/png", size: 100, checksum: "a".repeat(64) };
  it("accepts jpeg, png and webp up to 5 MB with a matching extension", () => {
    expect(newsletterImageInput.safeParse(ok).success).toBe(true);
    expect(newsletterImageInput.safeParse({ ...ok, name: "a.jpg", mime: "image/jpeg" }).success).toBe(true);
    expect(newsletterImageInput.safeParse({ ...ok, size: 5 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(newsletterImageInput.safeParse({ ...ok, mime: "image/gif", name: "a.gif" }).success).toBe(false);
    expect(newsletterImageInput.safeParse({ ...ok, mime: "application/pdf", name: "a.pdf" }).success).toBe(false);
    expect(newsletterImageInput.safeParse({ ...ok, name: "a.jpg" }).success).toBe(false);
    expect(newsletterImageInput.safeParse({ ...ok, name: "../a.png" }).success).toBe(false);
  });
  it("pre-checks in the browser", () => {
    expect(newsletterImageProblem({ name: "a.png", type: "image/png", size: 10 })).toBeNull();
    expect(newsletterImageProblem({ name: "a.gif", type: "image/gif", size: 10 })).toBe("type");
    expect(newsletterImageProblem({ name: "a.png", type: "image/png", size: 6 * 1024 * 1024 })).toBe("size");
  });
});

describe("alt text rule", () => {
  const image = (patch: object) => ({ ...newBlock("image", {}, "b-img"), ...patch }) as EmailDocument["blocks"][number];
  it("requires a description for the image block and uploaded images unless decorative", () => {
    expect(emailDocumentSchema.safeParse(doc([image({ imageUrl: "https://example.com/a.png" })])).success).toBe(false);
    expect(emailDocumentSchema.safeParse(doc([image({ fileId })])).success).toBe(false);
    expect(emailDocumentSchema.safeParse(doc([image({ fileId, alt: "A church" })])).success).toBe(true);
    expect(emailDocumentSchema.safeParse(doc([image({ fileId, decorative: true })])).success).toBe(true);
    expect(emailDocumentSchema.safeParse(doc([image({})])).success).toBe(true);
    expect(emailDocumentSchema.safeParse(doc([newBlock("text", { text: "x" }, "b-txt")], { imageUrl: "", fileId, alt: "" })).success).toBe(false);
    expect(emailDocumentSchema.safeParse(doc([newBlock("text", { text: "x" }, "b-txt")], { imageUrl: "", fileId, alt: "", decorative: true })).success).toBe(true);
  });
  it("keeps older linked hero images valid but warned by the inbox check", () => {
    const hero = { ...newBlock("hero", { heading: "H" }, "b-hero"), imageUrl: "https://example.com/a.png" } as EmailDocument["blocks"][number];
    expect(emailDocumentSchema.safeParse(doc([hero])).success).toBe(true);
    expect(inboxCheck({ subject: "s", preheader: "p", doc: doc([hero]) }).find((c) => c.id === "imageAlt")).toMatchObject({ level: "warn", count: 1 });
  });
  it("rejects unknown keys and an invalid file id", () => {
    expect(blockSchema.safeParse({ ...newBlock("image", {}, "b-img"), fileId: "nope" }).success).toBe(false);
    expect(blockSchema.safeParse({ ...newBlock("image", {}, "b-img"), extra: 1 }).success).toBe(false);
  });
  it("lists each uploaded image once", () => {
    const blocks = [{ ...newBlock("image", {}, "b-one"), fileId, alt: "a" }, { ...newBlock("video", {}, "b-two"), fileId: other, alt: "v" }, { ...newBlock("image", {}, "b-three"), fileId, alt: "a" }] as EmailDocument["blocks"];
    expect(documentFileIds({ blocks, cover: { imageUrl: "", fileId: other, alt: "c" } }).sort()).toEqual([fileId, other].sort());
  });
});

describe("cover, image and video rendering", () => {
  const images = new Map([[fileId, url(fileId)], [other, url(other)]]);
  it("renders the cover first, full width up to 600px, with escaped alt text, only from the server map", () => {
    const d = doc([newBlock("text", { text: "Hi" }, "b-txt")], { imageUrl: "", fileId, alt: 'Cover "one" <b>' });
    const out = renderEmail(d, { ...context, images });
    expect(out.html).toContain(`<img src="${url(fileId)}" alt="Cover &quot;one&quot; &lt;b&gt;" width="600"`);
    expect(out.html.indexOf(url(fileId))).toBeLessThan(out.html.indexOf("Hi"));
    expect(out.html).toContain("max-width:600px");
    expect(out.html).not.toContain("<b>");
    expect(out.text).toContain('[Cover "one" <b>]');
    // Not in the map (not scanned/ready): nothing is rendered, and a link-less cover is never invented.
    expect(renderEmail(d, context).html).not.toContain("<img");
    // A map entry that is not https is refused outside the editor preview.
    expect(renderEmail(d, { ...context, images: new Map([[fileId, "http://insecure.test/a.png"]]) }).html).not.toContain("insecure");
    expect(renderEmail(d, { ...context, preview: true, images: new Map([[fileId, `/api/files/public/${other}/${fileId}`]]) }).html).toContain(`/api/files/public/${other}/${fileId}`);
    expect(renderEmail(d, { ...context, preview: true, images: new Map([[fileId, "javascript:alert(1)"]]) }).html).not.toContain("javascript");
  });
  it("renders a decorative cover with empty alt and an uploaded image block, optionally linked", () => {
    const decorative = renderEmail(doc([newBlock("divider", {}, "b-div")], { imageUrl: "", fileId, alt: "", decorative: true }), { ...context, images });
    expect(decorative.html).toContain('alt=""');
    expect(decorative.text).not.toContain("[");
    const block = { ...newBlock("image", {}, "b-img"), fileId: other, alt: "Choir", linkUrl: "https://example.com/choir?a=1&b=2" } as EmailDocument["blocks"][number];
    const out = renderEmail(doc([block]), { ...context, images });
    expect(out.html).toContain(`<a href="https://example.com/choir?a=1&amp;b=2" target="_blank"><img src="${url(other)}" alt="Choir"`);
    expect(out.text).toContain("[Choir] https://example.com/choir?a=1&b=2");
    expect(renderEmail(doc([{ ...block, linkUrl: "javascript:alert(1)" } as typeof block]), { ...context, images }).html).not.toContain("javascript");
  });
  it("renders a video as a table-based thumbnail with a play button linking to the video, plus a text link and plain-text fallback", () => {
    const block = { ...newBlock("video", { caption: "Sunday <service>" }, "b-vid"), fileId, alt: "Service video", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1" } as EmailDocument["blocks"][number];
    const out = renderEmail(doc([block]), { ...context, images });
    expect(out.html).toContain(`background-image:url('${url(fileId)}')`);
    expect(out.html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;x=1"');
    expect(out.html).toContain("&#x25B6;");
    expect(out.html).toContain("Sunday &lt;service&gt;");
    expect(out.html).not.toContain("img.youtube.com");
    expect(out.html).not.toContain("<video");
    expect(out.text).toContain("Watch the video: https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1");
  });
  it("shows no play overlay without a thumbnail, and no link without a valid video link", () => {
    const base = { ...newBlock("video", {}, "b-vid"), videoUrl: "http://not-secure.test/v" } as EmailDocument["blocks"][number];
    const out = renderEmail(doc([base]), { ...context, images });
    expect(out.html).not.toContain("&#x25B6;");
    expect(out.html).not.toContain("not-secure");
    expect(out.text).not.toContain("Watch the video");
    const linked = renderEmail(doc([{ ...base, thumbnailUrl: "https://example.com/t.jpg", videoUrl: "https://vk.com/video-1_2" } as typeof base]), context);
    expect(linked.html).toContain("https://example.com/t.jpg");
    expect(linked.html).toContain("https://vk.com/video-1_2");
  });
  it("still passes every older block through unchanged", () => {
    const out = renderEmail(doc([newBlock("hero", { heading: "H" }, "b-hero")]), context);
    expect(out.html).toContain("H");
  });
});
