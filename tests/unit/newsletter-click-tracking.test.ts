import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultBrand, type EmailDocument } from "@/lib/email/blocks";
import { renderEmail } from "@/lib/email/render";
import { renderNewsletter } from "@/lib/newsletter-content";
import { automationClickUrl, clickRewriter, clickTokenPattern, clickUrl, linkCollector, MAX_TRACKED_LINKS, readClickToken, signAutomationClickToken, signClickToken, verifyClickToken, type AutomationClickReference, type ClickReference } from "@/lib/newsletter-click-token";

const key = randomBytes(32);
const reference: ClickReference = { tenant: randomUUID(), campaign: randomUUID(), revision: 3, delivery: randomUUID(), link: 2 };
const unsubscribe = "https://newsletter.example.test/api/newsletter/unsubscribe?token=abc.def";
const urls = { text: "https://ministry.example.invalid/read", hero: "https://ministry.example.invalid/hero", image: "https://ministry.example.invalid/photo-link",
  video: "https://video.example.invalid/watch", social: "https://social.example.invalid/ministry", giving: "https://ministry.example.invalid/give" };
const picture = "https://cdn.example.invalid/photo.png", logo = "https://cdn.example.invalid/logo.png";
const doc: EmailDocument = { version: 2, brand: { ...defaultBrand, logoUrl: logo, address: "1 Main Street" }, blocks: [
  { id: "b-header", type: "header", title: "News", showLogo: true, align: "left" },
  { id: "b-hero", type: "hero", imageUrl: "", alt: "", heading: "Hello", text: "Welcome", buttonLabel: "Read", buttonUrl: urls.hero },
  { id: "b-text", type: "text", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "the plan", marks: [{ type: "link", attrs: { href: urls.text } }] }] }] } },
  { id: "b-image", type: "image", imageUrl: picture, alt: "A photo", linkUrl: urls.image },
  { id: "b-video", type: "video", thumbnailUrl: picture, alt: "Video", videoUrl: urls.video, caption: "" },
  { id: "b-social", type: "social", links: [{ label: "Follow", url: urls.social }] },
  { id: "b-giving", type: "giving", heading: "Give", text: "", buttonLabel: "Give", buttonUrl: urls.giving },
] };

describe("click tokens", () => {
  it("round-trip the references and carry no address or destination", () => {
    const token = signClickToken(key, reference);
    expect(token).toMatch(clickTokenPattern);
    expect(verifyClickToken(key, token)).toEqual(reference);
    expect(Buffer.from(token.split(".")[0], "base64url").toString("latin1")).not.toMatch(/https|example/);
    expect(Buffer.from(token.split(".")[0], "base64url")).toHaveLength(55);
    expect(new URL(clickUrl("https://newsletter.example.test", key, reference)).pathname).toBe("/api/newsletter/link");
  });

  it("reject tampering, another key, other purposes and malformed input", () => {
    const token = signClickToken(key, reference), [payload, signature] = token.split(".");
    const swap = (value: string, at: number) => value.slice(0, at) + (value[at] === "A" ? "B" : "A") + value.slice(at + 1);
    expect(verifyClickToken(key, `${swap(payload, 30)}.${signature}`)).toBeNull();
    expect(verifyClickToken(key, `${payload}.${swap(signature, 5)}`)).toBeNull();
    expect(verifyClickToken(randomBytes(32), token)).toBeNull();
    // A non-canonical spelling (changed unused trailing bits) is refused too.
    const last = signature.at(-1)!, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    expect(verifyClickToken(key, `${payload}.${signature.slice(0, -1)}${alphabet[alphabet.indexOf(last) ^ 1]}`)).toBeNull();
    expect(verifyClickToken(null, token)).toBeNull();
    for (const bad of [undefined, 42, "", "a.b", token + "x", `${payload}.${signature}.extra`]) expect(verifyClickToken(key, bad)).toBeNull();
    expect(() => signClickToken(key, { ...reference, link: MAX_TRACKED_LINKS })).toThrow();
    expect(() => signClickToken(key, { ...reference, tenant: "not-a-uuid" })).toThrow();
    expect(() => signClickToken(key, { ...reference, revision: 0 })).toThrow();
  });

  it("sign automation links with their own version: never read as a campaign link, and the other way round", () => {
    const automation: AutomationClickReference = { tenant: randomUUID(), automation: randomUUID(), attempt: randomUUID(), link: 4 };
    const token = signAutomationClickToken(key, automation);
    expect(token).toMatch(clickTokenPattern);
    expect(readClickToken(key, token)).toEqual({ kind: "automation", reference: automation });
    expect(verifyClickToken(key, token)).toBeNull();
    expect(readClickToken(key, signClickToken(key, reference))).toEqual({ kind: "campaign", reference });
    expect(readClickToken(randomBytes(32), token)).toBeNull();
    expect(Buffer.from(token.split(".")[0], "base64url").toString("latin1")).not.toMatch(/https|example/);
    expect(new URL(automationClickUrl("https://newsletter.example.test", key, automation)).pathname).toBe("/api/newsletter/link");
    expect(() => signAutomationClickToken(key, { ...automation, link: MAX_TRACKED_LINKS })).toThrow();
    expect(() => signAutomationClickToken(key, { ...automation, attempt: "nope" })).toThrow();
  });
});

describe("link rewriting at send time", () => {
  it("rewrites every content link of a block document and never the unsubscribe, image or logo addresses", () => {
    const collector = linkCollector();
    renderEmail(doc, { unsubscribe, track: collector.track });
    expect(collector.seen).toEqual([urls.hero, urls.text, urls.image, urls.video, urls.social, urls.giving]);
    const rewrite = clickRewriter(collector.seen, (index) => `https://newsletter.example.test/api/newsletter/link?t=L${index}`);
    const out = renderEmail(doc, { unsubscribe, track: rewrite, clicksCounted: true });
    for (const url of Object.values(urls)) {
      expect(out.html).not.toContain(`href="${url}"`);
      expect(out.text).not.toContain(url);
    }
    for (const index of [0, 1, 2, 3, 4, 5]) expect(out.html).toContain(`link?t=L${index}`);
    expect(out.html).toContain(`href="${unsubscribe.replace("&", "&amp;")}"`);
    expect(out.headers["List-Unsubscribe"]).toBe(`<${unsubscribe}>`);
    expect(out.text).toContain(`Unsubscribe: ${unsubscribe}`);
    expect(out.html).toContain(`src="${picture}"`);
    expect(out.html).toContain(`src="${logo}"`);
    expect(out.html).toContain("This ministry counts link clicks in its emails, as totals only.");
    expect(out.text).toContain("This ministry counts link clicks in its emails, as totals only.");
  });

  it("rewrites the original block list's links and button but not its unsubscribe footer", () => {
    const legacy = [
      { type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "read", marks: [{ type: "link", attrs: { href: urls.text } }] }] }] } },
      { type: "button", label: "Give", href: urls.giving },
    ];
    const collector = linkCollector();
    renderNewsletter(legacy, { unsubscribe, track: collector.track });
    expect(collector.seen).toEqual([urls.text, urls.giving]);
    const out = renderNewsletter(legacy, { unsubscribe, track: clickRewriter(collector.seen, (index) => `https://newsletter.example.test/r${index}`), clicksCounted: true });
    expect(out.html).toContain('href="https://newsletter.example.test/r0"');
    expect(out.html).toContain('href="https://newsletter.example.test/r1"');
    expect(out.html).not.toContain(urls.text);
    expect(out.html).toContain(unsubscribe);
    expect(out.headers["List-Unsubscribe"]).toBe(`<${unsubscribe}>`);
    expect(out.text).toContain("counts link clicks");
  });

  it("changes nothing when counting is off", () => {
    const plain = renderEmail(doc, { unsubscribe });
    for (const url of Object.values(urls)) expect(plain.html).toContain(url);
    expect(plain.html).not.toContain("counts link clicks");
    expect(plain.text).not.toContain("counts link clicks");
    const legacy = renderNewsletter([{ type: "button", label: "Give", href: urls.giving }], { unsubscribe });
    expect(legacy.html).toContain(`href="${urls.giving}"`);
    expect(legacy.html).not.toContain("counts link clicks");
  });

  it("leaves a link outside the stored list as written and caps the list", () => {
    const rewrite = clickRewriter([urls.text], () => "https://newsletter.example.test/r0");
    expect(rewrite(urls.giving)).toBe(urls.giving);
    expect(rewrite(urls.text)).toBe("https://newsletter.example.test/r0");
    const collector = linkCollector();
    for (let index = 0; index < MAX_TRACKED_LINKS + 10; index++) collector.track(`https://ministry.example.invalid/${index}`);
    collector.track("https://ministry.example.invalid/0");
    expect(collector.seen).toHaveLength(MAX_TRACKED_LINKS);
  });
});
