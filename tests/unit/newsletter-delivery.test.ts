import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { inspectNewsletterBoundary } from "../../scripts/source-guards";
import { FakeNewsletterProvider, signFakeNewsletterCallback } from "../../src/server/newsletter-delivery/fake-provider";
import { newsletterContent, renderNewsletter } from "../../src/server/newsletter-delivery/render";
import { defaultNewsletterProvider, NEWSLETTER_INTEGRATION_ENABLED, NEWSLETTER_SENDER_ENABLED,
  NEWSLETTER_TRACKING_ENABLED } from "../../src/server/newsletter-delivery/registry";

vi.mock("server-only", () => ({}));
const doc = (text: string, href?: string) => ({ type: "doc", content: [{ type: "paragraph", content: [
  { type: "text", text, marks: href ? [{ type: "link", attrs: { href, onclick: "bad()" } }] : [] },
] }] });
const footer = { name: "Ministry <name>", email: "sender@example.test", postalAddress: "100 <Main>",
  unsubscribe: "https://newsletter.example.test/unsubscribe?token=test&scope=list" };

it("escapes markup, assigns server link ids and adds the required footer in both formats", () => {
  const rendered = renderNewsletter(doc("<script>alert(1)</script>", "https://example.test/?foo=1&bar=2"), footer);
  expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(rendered.html).toContain('data-newsletter-link="1"');
  expect(rendered.html).toContain("foo=1&amp;bar=2");
  expect(rendered.html).toContain("Ministry &lt;name&gt;");
  expect(rendered.html).toContain("100 &lt;Main&gt;");
  expect(rendered.html).not.toMatch(/<script|onclick/i);
  expect(rendered.text).toContain(footer.unsubscribe);
  expect(rendered.text).toContain(footer.postalAddress);
  expect([...rendered.links]).toEqual([[1, "https://example.test/?foo=1&bar=2"]]);
});
it("rejects remote embeds, insecure, credential-bearing and script links", () => {
  expect(newsletterContent({ type: "doc", content: [{ type: "image", attrs: { src: "https://example.test/img" } }] })).toBeNull();
  for (const href of ["javascript:alert(1)", "http://example.test", "https://user:secret@example.test", "mailto:person@example.test"]) {
    expect(newsletterContent(doc("unsafe", href))).toBeNull();
  }
});
it("authenticates exact callback bytes and drops everything outside the fixed contract", () => {
  const provider = new FakeNewsletterProvider("credential"), secret = "test-hook-secret";
  const event = { tenantId: randomUUID(), id: randomUUID(), deliveryId: randomUUID(), providerId: randomUUID(),
    outcome: "clicked", linkId: 1, occurredAt: new Date().toISOString() };
  const raw = Buffer.from(JSON.stringify({ ...event, rawBody: "must not leak", email: "private@example.test" }));
  const signature = signFakeNewsletterCallback(raw, secret);
  expect(provider.verifyCallback(raw, signature, secret)).toEqual(event);
  expect(provider.verifyCallback(Buffer.concat([raw, Buffer.from(" ")]), signature, secret)).toBeNull();
  expect(provider.verifyCallback(raw, signature, "different")).toBeNull();
  expect(provider.verifyCallback(Buffer.alloc(8193), signature, secret)).toBeNull();
});
it("keeps HTTP, sender, live provider and tracking hard-off", async () => {
  expect([NEWSLETTER_INTEGRATION_ENABLED, NEWSLETTER_SENDER_ENABLED, NEWSLETTER_TRACKING_ENABLED]).toEqual([false, false, false]);
  const { POST } = await import("../../src/app/api/integrations/newsletter/callback/route");
  const { createCampaignRoute } = await import("../../src/server/newsletter-delivery/routes");
  const request = new Request("https://newsletter.example.test", { method: "POST", body: "invalid" });
  expect((await POST(request)).status).toBe(404);
  expect((await createCampaignRoute(request, { params: Promise.resolve({ tenantId: randomUUID() }) })).status).toBe(404);
  expect(request.bodyUsed).toBe(false);
  expect(await defaultNewsletterProvider().verifySender({ secret: "fake" }, "example.test")).toBe(false);
});
it("catches network, activation, persistence and scheduling regressions in source guards", () => {
  expect(inspectNewsletterBoundary("src/server/newsletter-delivery/registry.ts", "export const NEWSLETTER_INTEGRATION_ENABLED = true;")).toHaveLength(3);
  expect(inspectNewsletterBoundary("src/server/newsletter-delivery/worker.ts", "fetch(url)")).toHaveLength(1);
  expect(inspectNewsletterBoundary("src/server/newsletter-delivery/port.ts", "trackOpens: true")).toHaveLength(1);
  expect(inspectNewsletterBoundary("drizzle/0073_newsletter_server.sql", 'CREATE TABLE "newsletter_delivery_events" (\n "raw_body" text\n);')).toHaveLength(3);
  expect(inspectNewsletterBoundary("scripts/schedule-newsletter.ts", 'import { drainNewsletter } from "../src/server/newsletter-delivery/worker";')).toHaveLength(1);
});
