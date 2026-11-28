type Env = Record<string, string | undefined>;

const sendPath = "/v2/email/outbound-emails";
const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
const encode = new TextEncoder();
const hex = (data: ArrayBuffer) => Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
const addressPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

export function stagingEmailEnabled(env: Env) {
  return env.HARVEST_ENV === "staging" && env.VERCEL_ENV !== "production" && env.EMAIL_LIVE_STAGING === "1";
}

function allowedAddress(env: Env, value: string) {
  const address = value.trim();
  const allowlist = (env.EMAIL_STAGING_ALLOWLIST ?? "").split(/[\s,]+/);
  return address.length <= 254 && addressPattern.test(address) && allowlist.includes(address) ? address : null;
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, text: string) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encode.encode(text));
}

type Mail = {
  to: string; subject: string; text: string; html?: string; replyTo?: string;
  headers: Record<string, string>; deliveryId: string; signal?: AbortSignal;
};

export function stagingEmailPayload(mail: Mail, from: string, configurationSet: string) {
  const data = (Data: string) => ({ Data, Charset: "UTF-8" });
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [mail.to] },
    ReplyToAddresses: mail.replyTo ? [mail.replyTo] : undefined,
    ConfigurationSetName: configurationSet,
    // Delivery correlation for the existing newsletter verifier and community feedback when #322 lands.
    EmailTags: [{ Name: "harvest_delivery_id", Value: mail.deliveryId }],
    Content: { Simple: {
      Subject: data(mail.subject),
      Body: { Text: data(mail.text), Html: mail.html === undefined ? undefined : data(mail.html) },
      Headers: Object.entries(mail.headers).map(([Name, Value]) => ({ Name, Value })),
    } },
  };
}

export class StagingEmailRefused extends Error {
  constructor() { super("STAGING_EMAIL_REFUSED"); }
}

/** Shared by the community sender and the newsletter provider port. Tests inject a loopback-only transport. */
export async function submitStagingEmail(env: Env, mail: Mail, transport: typeof fetch = fetch, now = new Date()) {
  const to = allowedAddress(env, mail.to);
  const { SES_ACCESS_KEY_ID: key, SES_SECRET_ACCESS_KEY: secret, SES_REGION: region,
    SES_FROM_ADDRESS: from, SES_CONFIGURATION_SET: configurationSet } = env;
  if (!stagingEmailEnabled(env) || !to || !key || !secret || !region || !from || !configurationSet ||
      !/^[A-Z0-9]+$/.test(key) || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region) ||
      !addressPattern.test(from) || !/^[\w-]{1,64}$/.test(configurationSet) ||
      !/^[\w-]{1,256}$/.test(mail.deliveryId)) throw new StagingEmailRefused();

  const host = `email.${region}.amazonaws.com`;
  const body = JSON.stringify(stagingEmailPayload({ ...mail, to }, from, configurationSet));
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = timestamp.slice(0, 8);
  const digest = hex(await crypto.subtle.digest("SHA-256", encode.encode(body)));
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${digest}\nx-amz-date:${timestamp}\n`;
  const canonical = ["POST", sendPath, "", canonicalHeaders, signedHeaders, digest].join("\n");
  const scope = `${day}/${region}/ses/aws4_request`;
  const canonicalHash = hex(await crypto.subtle.digest("SHA-256", encode.encode(canonical)));
  const signingKey = await hmac(await hmac(await hmac(await hmac(encode.encode("AWS4" + secret), day), region), "ses"), "aws4_request");
  const signature = hex(await hmac(signingKey, ["AWS4-HMAC-SHA256", timestamp, scope, canonicalHash].join("\n")));
  const response = await transport(`https://${host}${sendPath}`, {
    method: "POST", body, redirect: "error",
    signal: mail.signal ?? AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json", "X-Amz-Date": timestamp, "X-Amz-Content-Sha256": digest,
      Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 400 && response.status < 500 && response.status !== 408) throw new StagingEmailRefused();
    throw new Error("STAGING_EMAIL_SEND_FAILED");
  }
  const receipt = await response.json() as { MessageId?: unknown };
  if (typeof receipt.MessageId !== "string" || !/^[\w-]{1,255}$/.test(receipt.MessageId)) {
    throw new Error("STAGING_EMAIL_RECEIPT_UNAVAILABLE");
  }
  return receipt.MessageId;
}
