import { createHmac, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { register } from "../../src/instrumentation";
import { checkNewsletterSuppressionStartup } from "../../src/server/newsletter-campaigns/suppression-keys";
import { newsletterContent, renderNewsletter } from "../../src/lib/newsletter-content";
import { FakeNewsletterProvider } from "../../src/server/newsletter-campaigns/fake-provider";
import { newsletterCallback } from "../../src/server/newsletter-campaigns/callback";
import { newsletterScheduleHorizonMs, scheduleInput } from "../../src/server/newsletter-campaigns/schedule";
import { buildSesSend, sesAdapter } from "../../src/server/newsletter-campaigns/ses-adapter";
import { newsletterWorkerEnabled } from "../../src/server/newsletter-campaigns/worker";

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
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-10-07T00:00:00Z"));
  try {
    const parses = (at: string, timezone = "America/New_York") =>
      scheduleInput.safeParse({ mode: "schedule", schedule: { at, timezone } }).success;
    expect(parses("2027-11-07T01:30:00-04:00")).toBe(true);
    expect(parses("2027-11-07T01:30:00-05:00")).toBe(true);
    clock.mockReturnValue(Date.parse("2027-02-14T00:00:00Z"));
    expect(parses("2027-03-14T02:30:00-05:00")).toBe(false);
    clock.mockReturnValue(Date.parse("2027-10-07T00:00:00Z"));
    expect(parses("2027-11-07T01:30:00-06:00")).toBe(false);
    expect(parses("2027-11-07T01:30:00-04:00", "garbage")).toBe(false);
  } finally { clock.mockRestore(); }
});

it("authenticates a bounded envelope and discards addresses and raw text", () => {
  const key = Buffer.alloc(32, 7), provider = new FakeNewsletterProvider(key), now = new Date(), deliveryId = randomUUID(), reference = "provider-" + randomUUID(), messageId = randomUUID();
  const body = Buffer.from(JSON.stringify({ messageId, deliveryId, reference, type: "bounced", at: now.toISOString(), email: "reader@example.test", raw: "text" }));
  const timestamp = now.getTime().toString();
  const signature = createHmac("sha256", key).update(timestamp).update(".").update(body).digest("hex");
  const headers = new Headers({ "x-newsletter-timestamp": timestamp, "x-newsletter-signature": signature });
  expect(provider.verifyCallback(body, headers, now)).toEqual({ messageId, signedAt: now, deliveryId, reference, type: "bounced", at: now });
  expect(provider.verifyCallback(Buffer.concat([body, Buffer.from(" ")]), headers, now)).toBeNull();
  expect(provider.verifyCallback(body, headers, new Date(now.getTime() + 86_400_001))).toBeNull();
});

it("answers 404 while disabled before touching credentials or the body", async () => {
  const req = new Request("https://example.test/callback", { method: "POST", body: "never read" });
  expect((await newsletterCallback(req, { NODE_ENV: "production", HARVEST_NEWSLETTER_CALLBACK_ENABLED: "1" },
    () => { throw new Error("unexpected connection"); })).status).toBe(404);
  expect(req.bodyUsed).toBe(false);
});

it("keeps vendor names and live transport out of the newsletter domain", () => {
  const source = "src/server/newsletter-campaigns";
  const vendor = /\b(?:plunk|amazon ses|aws ses|sesAdapter)\b/i;
  for (const file of readdirSync(source)) {
    const contents = readFileSync(source + "/" + file, "utf8");
    if (file !== "ses-adapter.ts") expect(contents).not.toMatch(vendor);
    expect(contents).not.toMatch(/\bfetch\s*\(|node:https|node:http|@aws-sdk|from ["']resend["']/);
  }
  expect(readFileSync(source + "/ses-adapter.ts", "utf8")).toMatch(/export const LIVE_NEWSLETTER_ENABLED = false;/);
  const migration = readFileSync("drizzle/0073_newsletter_sending.sql", "utf8");
  const deliveryColumns = migration.match(/CREATE TABLE "newsletter_deliveries" \([\s\S]*?\n\);/)?.[0];
  expect(deliveryColumns).toBeTruthy();
  expect(deliveryColumns).not.toMatch(/"(email|body|html|payload|headers|remote_address|user_agent)"/i);
});

it("permits explicit synthetic worker flags only in development or test", () => {
  const flag = "HARVEST_NEWSLETTER_WORKER_ENABLED";
  expect(newsletterWorkerEnabled({ NODE_ENV: "test", [flag]: "1" }, flag)).toBe(true);
  expect(newsletterWorkerEnabled({ VERCEL_ENV: "preview", [flag]: "1" }, flag)).toBe(false);
  expect(newsletterWorkerEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview", [flag]: "1" }, flag)).toBe(false);
  expect(newsletterWorkerEnabled({ NODE_ENV: "development", VERCEL_ENV: "production", [flag]: "1" }, flag)).toBe(false);
});

it("puts the immutable delivery tag, headers, and text alternative in the injected send contract", async () => {
  const deliveryId = randomUUID();
  const newsletter = { deliveryId, from: "updates@ministry.example.test", to: "reader@example.test", replyTo: "replies@example.test",
    subject: "Update", preheader: "This week", html: "<p>Hello</p>", text: "Hello",
    headers: { "List-Unsubscribe": "<" + unsubscribe + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
  expect(buildSesSend(newsletter, "test-config")).toMatchObject({
    ConfigurationSetName: "test-config", EmailTags: [{ Name: "harvest_delivery_id", Value: deliveryId }],
    Content: { Simple: { Body: { Html: { Data: newsletter.html }, Text: { Data: newsletter.text } },
      Headers: [{ Name: "List-Unsubscribe", Value: newsletter.headers["List-Unsubscribe"] },
        { Name: "List-Unsubscribe-Post", Value: newsletter.headers["List-Unsubscribe-Post"] }] } },
  });
  const send = vi.fn().mockResolvedValue({ MessageId: "fake-test-receipt" });
  const adapter = sesAdapter({ topicArn: "test", certificates: new Map() }, { configurationSet: "test-config", send });
  expect(await adapter.submit(newsletter)).toEqual({ state: "failed" });
  expect(send).not.toHaveBeenCalled();
});

it("verifies an injected SNS signature, topic, certificate URL and timestamp before projecting delivery evidence", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const certURL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem";
  const topic = "arn:aws:sns:us-east-1:123456789012:synthetic";
  const now = new Date(), deliveryId = randomUUID(), reference = "0100-provider-id";
  const mail = { timestamp: now.toISOString(), messageId: reference, tags: { harvest_delivery_id: [deliveryId] } };
  const adapter = sesAdapter({ topicArn: topic, certificates: new Map([[certURL, publicKey.export({ type: "spki", format: "pem" })]]) });
  const envelope = { Type: "Notification", MessageId: randomUUID(), TopicArn: topic,
    Timestamp: now.toISOString(), SignatureVersion: "2", SigningCertURL: certURL,
    Message: JSON.stringify({ eventType: "Delivery", mail, delivery: { timestamp: now.toISOString(), recipients: ["reader@example.test"] } }) };
  function signed(overrides: Partial<typeof envelope> = {}) {
    const event = { ...envelope, ...overrides };
    const fields = ["Message", "MessageId", "Timestamp", "TopicArn", "Type"] as const;
    const signature = createSign("RSA-SHA256").update(fields.flatMap(field => [field, event[field]]).join("\n") + "\n")
      .sign(privateKey, "base64");
    return { ...event, Signature: signature };
  }
  const verify = (body: ReturnType<typeof signed>) =>
    adapter.verifyCallback(Buffer.from(JSON.stringify(body)), new Headers(), now);
  expect(verify(signed())).toEqual({ messageId: envelope.MessageId, signedAt: now, deliveryId, reference, type: "delivered", at: now });
  expect(verify({ ...signed(), Message: "{}" })).toBeNull();
  expect(verify(signed({ TopicArn: topic + "-other" }))).toBeNull();
  expect(verify(signed({ SigningCertURL: certURL + "?alternate=1" }))).toBeNull();
  expect(verify(signed({ SigningCertURL: certURL.replace(".amazonaws.com", ".amazonaws.com.example.test") }))).toBeNull();
  expect(verify(signed({ Timestamp: new Date(now.getTime() - 86_400_000).toISOString() }))).not.toBeNull();
  expect(verify(signed({ Timestamp: new Date(now.getTime() - 86_400_001).toISOString() }))).toBeNull();
  expect(verify(signed({ Timestamp: new Date(now.getTime() + 300_001).toISOString() }))).toBeNull();
  expect(verify(signed({ SignatureVersion: "1" }))).toBeNull();
  expect(verify(signed({ Message: JSON.stringify({ eventType: "Bounce", mail,
    bounce: { timestamp: now.toISOString(), bounceType: "Transient" } }) }))).toBeNull();
  expect(verify(signed({ Message: JSON.stringify({ eventType: "Bounce", mail,
    bounce: { timestamp: now.toISOString(), bounceType: "Permanent" } }) }))).toMatchObject({ type: "bounced" });
});


it("requires a schedule within 60 days with a specific validation message", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const input = (delta: number) => ({ mode: "schedule", schedule: {
    timezone: "UTC", at: new Date(now + delta).toISOString().replace(".000Z", "Z"),
  } });
  try {
    expect(scheduleInput.safeParse(input(newsletterScheduleHorizonMs)).success).toBe(true);
    expect(scheduleInput.safeParse(input(newsletterScheduleHorizonMs + 1000)).error?.issues[0]).toMatchObject({
      path: ["schedule", "at"], message: "Schedule the newsletter within 60 days of review.",
    });
  } finally { clock.mockRestore(); }
});

it("fails closed at web and worker startup and reports only suppression key ring status and count", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const ring = JSON.stringify(["ab".repeat(32), "cd".repeat(32)]);
  try {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    for (const invalid of [undefined, "invalid json", JSON.stringify(["ab".repeat(32), "ab".repeat(32)])]) {
      vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", invalid);
      await expect(register()).rejects.toThrow(/^NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE$/);
      expect(() => checkNewsletterSuppressionStartup("worker", process.env)).toThrow(/^NEWSLETTER_SUPPRESSION_KEYS_UNAVAILABLE$/);
    }
    expect(error.mock.calls.flat().map(line => JSON.parse(line))).toEqual(Array.from({ length: 3 }, () => ["web", "worker"]).flat().map(runtime =>
      ({ event: "newsletter_suppression_key_ring", runtime, status: "missing", keyVersionCount: 0 })));
    vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", ring);
    await register();
    checkNewsletterSuppressionStartup("worker", process.env);
    expect(info.mock.calls.flat().map(line => JSON.parse(line))).toEqual(["web", "worker"].map(runtime =>
      ({ event: "newsletter_suppression_key_ring", runtime, status: "present", keyVersionCount: 2 })));
  } finally {
    vi.unstubAllEnvs();
    info.mockRestore();
    error.mockRestore();
  }
});
