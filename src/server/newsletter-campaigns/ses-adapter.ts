import { createVerify } from "node:crypto";
import { z } from "zod";
import { callbackClockSkewMs, callbackTimestampValid, type NewsletterProvider, type NewsletterSubmission } from "./port";

export const LIVE_NEWSLETTER_ENABLED = false;
const tag = "harvest_delivery_id";

export function buildSesSend(message: NewsletterSubmission, configurationSet: string) {
  return {
    FromEmailAddress: message.from,
    Destination: { ToAddresses: [message.to] },
    ReplyToAddresses: [message.replyTo],
    ConfigurationSetName: configurationSet,
    EmailTags: [{ Name: tag, Value: message.deliveryId }],
    Content: { Simple: {
      Subject: { Data: message.subject, Charset: "UTF-8" },
      Body: { Html: { Data: message.html, Charset: "UTF-8" }, Text: { Data: message.text, Charset: "UTF-8" } },
      Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })),
    } },
  };
}

const notification = z.object({
  Type: z.literal("Notification"), Message: z.string(), MessageId: z.uuid(), Subject: z.string().optional(),
  Timestamp: z.iso.datetime(), TopicArn: z.string(), SignatureVersion: z.literal("2"), Signature: z.base64(),
  SigningCertURL: z.string(),
});

const eventPayload = z.object({
  eventType: z.enum(["Send", "Delivery", "Bounce", "Complaint"]),
  mail: z.object({ messageId: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/), timestamp: z.iso.datetime(),
    tags: z.object({ [tag]: z.tuple([z.uuid()]) }) }),
  delivery: z.object({ timestamp: z.iso.datetime() }).optional(),
  bounce: z.object({ bounceType: z.string(), timestamp: z.iso.datetime() }).optional(),
  complaint: z.object({ timestamp: z.iso.datetime() }).optional(),
});

type TrustedSns = {
  topicArn: string;
  // Preloaded trusted SNS certs only. No network or certificate discovery.
  certificates: ReadonlyMap<string, string>;
};

export function sesAdapter(config: TrustedSns, submission?: {
  configurationSet: string;
  send: (request: ReturnType<typeof buildSesSend>) => Promise<{ MessageId?: string }>;
}): NewsletterProvider {
  return {
    async submit(message) {
      if (!LIVE_NEWSLETTER_ENABLED || !submission) return { state: "failed" };
      try {
        const receipt = await submission.send(buildSesSend(message, submission.configurationSet));
        return receipt.MessageId ? { state: "accepted", reference: receipt.MessageId } : { state: "unknown" };
      } catch { return { state: "unknown" }; }
    },
    verifyCallback(body, _headers, now) {
      if (body.byteLength > 8192) return null;
      try {
        const envelope = notification.parse(JSON.parse(Buffer.from(body).toString("utf8")));
        const topic = /^arn:aws:sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_-]+$/.exec(config.topicArn);
        if (!topic || envelope.TopicArn !== config.topicArn ||
            !callbackTimestampValid(Date.parse(envelope.Timestamp), now)) return null;
        const prefix = "https://sns." + topic[1] + ".amazonaws.com/";
        if (!envelope.SigningCertURL.startsWith(prefix) ||
            !/^SimpleNotificationService-[a-fA-F0-9]+\.pem$/.test(envelope.SigningCertURL.slice(prefix.length))) return null;
        const cert = config.certificates.get(envelope.SigningCertURL);
        if (!cert) return null;
        const fields = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const;
        const signed = fields.flatMap(name => envelope[name] === undefined ? [] : [name, envelope[name]]).join("\n") + "\n";
        if (!createVerify("RSA-SHA256").update(signed).verify(cert, envelope.Signature, "base64")) return null;

        const event = eventPayload.parse(JSON.parse(envelope.Message));
        const details = {
          Send: { type: "accepted", timestamp: event.mail.timestamp },
          Delivery: { type: "delivered", timestamp: event.delivery?.timestamp },
          Bounce: { type: "bounced", timestamp: event.bounce?.bounceType === "Permanent" ? event.bounce.timestamp : undefined },
          Complaint: { type: "complained", timestamp: event.complaint?.timestamp },
        } as const;
        const { type, timestamp } = details[event.eventType];
        if (!timestamp || Date.parse(timestamp) > now.getTime() + callbackClockSkewMs) return null;
        return { messageId: envelope.MessageId, signedAt: new Date(envelope.Timestamp), deliveryId: event.mail.tags[tag][0], reference: event.mail.messageId, type, at: new Date(timestamp) };
      } catch { return null; }
    },
    // Live registration, DNS lookup and quota provisioning remain outside this hard-off adapter.
    async domain() { return null; },
  };
}
