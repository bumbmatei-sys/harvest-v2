import { createHmac, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { newsletterContent, renderNewsletter } from "../../src/lib/newsletter-content";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { newsletterCallback } from "../../src/server/newsletter-campaigns/callback";
import { scheduleInput } from "../../src/server/newsletter-campaigns/schedule";

const unsubscribe = "https://example.test/api/newsletter/unsubscribe?token=signed";
const rich = (text: string, href = "https://example.test/?a=1&b=2") => [
  { type: "richText", doc: { type: "doc", content: [{ type: "heading", attrs: { level: 2 },
    content: [{ type: "text", text, marks: [{ type: "bold" }, { type: "link", attrs: { href } }] }] }] } },
  { type: "footer" },
];

it("escapes authored and merged content, keeps text parity and renders mandatory unsubscribe", () => {
  const rendered = renderNewsletter(rich("<script> {{firstName}} {{ministryName}} {{unknown}}"), {
    unsubscribe, ministryName: "<Ministry>",
  });
  expect(rendered.html).toContain("&lt;script&gt; friend &lt;Ministry&gt; {{unknown}}");
  expect(rendered.html).toContain("?a=1&amp;b=2");
  expect(rendered.text).toContain("<script> friend <Ministry> {{unknown}} (https://example.test/?a=1&b=2)");
  expect(rendered.text).toContain("Unsubscribe (" + unsubscribe + ")");
  expect(rendered.html.match(/<footer>/g)).toHaveLength(1);
  expect(rendered.headers).toEqual({ "List-Unsubscribe": "<" + unsubscribe + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});

it.each(["http://example.test", "javascript:alert(1)", "data:text/html,test", "https://person:pass@example.test"])(
  "refuses unsafe links %s", href => {
    expect(newsletterContent.safeParse(rich("Link", href)).success).toBe(false);
    expect(newsletterContent.safeParse([{ type: "button", label: "Link", href }]).success).toBe(false);
  });

it("requires an authorized image and refuses raw embeds and a duplicate footer", () => {
  const fileId = randomUUID();
  expect(() => renderNewsletter([{ type: "image", fileId, alt: "Photo" }], { unsubscribe })).toThrow("NEWSLETTER_IMAGE_UNAVAILABLE");
  expect(renderNewsletter([{ type: "image", fileId, alt: 'A "photo"' }], {
    unsubscribe, images: new Map([[fileId, "https://example.test/photo.png"]]),
  }).html).toContain('alt="A &quot;photo&quot;"');
  expect(newsletterContent.safeParse([{ type: "iframe" }]).success).toBe(false);
  expect(newsletterContent.safeParse([{ type: "footer" }, { type: "footer" }]).success).toBe(false);
});

it("accepts both annotated fall-back instants and rejects a DST gap and wrong offset", () => {
  const parses = (at: string, timezone = "America/New_York") =>
    scheduleInput.safeParse({ mode: "schedule", schedule: { at, timezone } }).success;
  expect(parses("2027-11-07T01:30:00-04:00")).toBe(true);
  expect(parses("2027-11-07T01:30:00-05:00")).toBe(true);
  expect(parses("2027-03-14T02:30:00-05:00")).toBe(false);
  expect(parses("2027-11-07T01:30:00-06:00")).toBe(false);
  expect(parses("2027-11-07T01:30:00-04:00", "garbage")).toBe(false);
});

it("authenticates a bounded envelope and discards addresses and raw text", () => {
  const key = Buffer.alloc(32, 7), provider = new FakeNewsletterProvider(key), now = new Date(), reference = randomUUID();
  const body = Buffer.from(JSON.stringify({ reference, type: "bounced", at: now.toISOString(), email: "reader@example.test", raw: "text" }));
  const timestamp = now.getTime().toString();
  const signature = createHmac("sha256", key).update(timestamp).update(".").update(body).digest("hex");
  const headers = new Headers({ "x-newsletter-timestamp": timestamp, "x-newsletter-signature": signature });
  expect(provider.verifyCallback(body, headers, now)).toEqual({ reference, type: "bounced", at: now });
  expect(provider.verifyCallback(Buffer.concat([body, Buffer.from(" ")]), headers, now)).toBeNull();
  expect(provider.verifyCallback(body, headers, new Date(now.getTime() + 301_000))).toBeNull();
});

it("answers 404 while disabled before touching credentials or the body", async () => {
  const req = new Request("https://example.test/callback", { method: "POST", body: "never read" });
  expect((await newsletterCallback(req, { NODE_ENV: "production", HARVEST_NEWSLETTER_CALLBACK_ENABLED: "1" },
    () => { throw new Error("unexpected connection"); })).status).toBe(404);
  expect(req.bodyUsed).toBe(false);
});

it("keeps vendor names and live transport out of the newsletter domain", () => {
  const source = "src/server/newsletter-campaigns";
  const vendor = new RegExp(["pl", "unk"].join(""), "i");
  for (const file of readdirSync(source)) {
    const contents = readFileSync(source + "/" + file, "utf8");
    if (file !== "provider-adapter.ts") expect(contents).not.toMatch(vendor);
    expect(contents).not.toMatch(/\bfetch\s*\(|node:https|node:http|@aws-sdk|from ["']resend["']/);
  }
  expect(readFileSync(source + "/provider-adapter.ts", "utf8")).toMatch(/export const LIVE_NEWSLETTER_ENABLED = false;/);
  const migration = readFileSync("drizzle/0073_newsletter_sending.sql", "utf8");
  const deliveryColumns = migration.match(/CREATE TABLE "newsletter_deliveries" \([\s\S]*?\n\);/)?.[0];
  expect(deliveryColumns).toBeTruthy();
  expect(deliveryColumns).not.toMatch(/"(email|body|html|payload|headers|remote_address|user_agent)"/i);
});
