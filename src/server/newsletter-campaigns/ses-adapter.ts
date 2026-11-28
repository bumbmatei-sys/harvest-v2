import { StagingEmailRefused, stagingEmailPayload, submitStagingEmail } from "../staging-email-transport";
import { createVerify } from "node:crypto";
import { z } from "zod";
import { callbackClockSkewMs, callbackTimestampValid, type NewsletterProvider, type NewsletterSubmission } from "./port";

export const LIVE_NEWSLETTER_ENABLED = false;
const tag = "harvest_delivery_id";

export function buildSesSend(message: NewsletterSubmission, configurationSet: string) {
  return stagingEmailPayload(message, message.from, configurationSet);
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
  env: Record<string, string | undefined>;
  transport?: typeof fetch;
}): NewsletterProvider {
  return {
    async submit(message) {
      if (!submission) return { state: "failed" };
      try {
        const reference = await submitStagingEmail(submission.env, message, submission.transport);
        return { state: "accepted", reference };
      } catch (error) { return { state: error instanceof StagingEmailRefused ? "failed" : "unknown" }; }
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
