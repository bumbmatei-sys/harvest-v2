import { createServer } from "node:http";
import { createHash, createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { createStagingCommunitySender } from "../../src/server/community-email-sender";
import { sesAdapter } from "../../src/server/newsletter-campaigns/ses-adapter";

it("signs and submits exactly one recipient per call to a fake HTTP server", async () => {
  const key = "FAKEACCESSKEY";
  const secret = "fake-secret-for-loopback-only";
  const env = { HARVEST_ENV: "staging", EMAIL_LIVE_STAGING: "1", EMAIL_STAGING_ALLOWLIST: "reader@example.invalid",
    SES_ACCESS_KEY_ID: key, SES_SECRET_ACCESS_KEY: secret, SES_FROM_ADDRESS: "sender@example.invalid",
    SES_REGION: "us-east-1", SES_CONFIGURATION_SET: "staging-example" };
  const seen: { body: string; authorization: string; date: string; digest: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    seen.push({ body, authorization: String(request.headers.authorization), date: String(request.headers["x-amz-date"]),
      digest: String(request.headers["x-amz-content-sha256"]) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ MessageId: "fake-receipt" }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local test address");
    const transport: typeof fetch = (url, init) => {
      expect(url).toBe("https://email.us-east-1.amazonaws.com/v2/email/outbound-emails");
      return fetch(`http://127.0.0.1:${address.port}/v2/email/outbound-emails`, init);
    };
    const newsletter = sesAdapter({ topicArn: "", certificates: new Map() }, { env, transport });
    const message = { to: "reader@example.invalid", from: "ignored@example.invalid", replyTo: "replies@example.invalid",
      text: "Test", html: "<p>Test</p>", subject: "Test", preheader: null,
      deliveryId: "newsletter-delivery", headers: { "List-Unsubscribe": "<https://example.invalid/unsubscribe>" } };
    await expect(newsletter.submit({ ...message, to: "elsewhere@example.invalid" })).resolves.toEqual({ state: "failed" });
    await expect(newsletter.submit(message)).resolves.toEqual({ state: "accepted", reference: "fake-receipt" });
    await createStagingCommunitySender(env, transport)({ ...message, deliveryId: "community-delivery", idempotencyKey: "community-key" });
    await expect(createStagingCommunitySender({ ...env, HARVEST_ENV: "production" }, transport)(
      { ...message, idempotencyKey: "refused" })).rejects.toThrow("COMMUNITY_EMAIL_DELIVERY_DISABLED");

    expect(seen).toHaveLength(2);
    for (const [index, request] of seen.entries()) {
      expect(JSON.parse(request.body)).toMatchObject({
        FromEmailAddress: "sender@example.invalid", Destination: { ToAddresses: ["reader@example.invalid"] },
        ConfigurationSetName: "staging-example", EmailTags: [{ Name: "harvest_delivery_id",
          Value: index === 0 ? "newsletter-delivery" : "community-delivery" }],
      });
      const digest = createHash("sha256").update(request.body).digest("hex");
      expect(request.digest).toBe(digest);
      const canonical = "POST\n/v2/email/outbound-emails\n\ncontent-type:application/json\nhost:email.us-east-1.amazonaws.com\n" +
        `x-amz-content-sha256:${digest}\nx-amz-date:${request.date}\n\ncontent-type;host;x-amz-content-sha256;x-amz-date\n${digest}`;
      const day = request.date.slice(0, 8), scope = `${day}/us-east-1/ses/aws4_request`;
      const signingKey = [day, "us-east-1", "ses", "aws4_request"].reduce((value, part) =>
        createHmac("sha256", value).update(part).digest(), Buffer.from("AWS4" + secret) as Buffer<ArrayBufferLike>);
      const signature = createHmac("sha256", signingKey).update(
        `AWS4-HMAC-SHA256\n${request.date}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`).digest("hex");
      expect(request.authorization).toBe(`AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${signature}`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
