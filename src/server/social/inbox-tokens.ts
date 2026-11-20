import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { getKeyProvider } from "../connect-key-provider";
import { fingerprintFields, type TransientReply } from "./inbox-reply-handoff";
import { publishConflict } from "./publish-access";

const PURPOSE = "social-inbox:v1" as const;
function inboxKey(id?: string) {
  const provider = getKeyProvider();
  const keyId = id ?? provider.currentKeyId(PURPOSE);
  return { keyId, key: provider.resolveKey(PURPOSE, keyId) };
}

export function inboxFingerprint(value: unknown, keyId?: string) {
  const { keyId: id, key } = inboxKey(keyId);
  return `${id}:${createHmac("sha256", key).update("inbox-reply:").update(JSON.stringify(value)).digest("hex")}`;
}

export function inboxCursor(payload: unknown) {
  const { keyId, key } = inboxKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("inbox-cursor:v1"));
  const packet = Buffer.concat([nonce, cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
  const encoded = packet.toString("base64url");
  const signature = createHmac("sha256", key).update(`inbox-cursor:v1:${keyId}:${encoded}`).digest("base64url");
  return `${keyId}.${encoded}.${signature}`;
}

export function openInboxCursor<T>(token: string, schema: z.ZodType<T>): T {
  try {
    const [id, encoded, signature, extra] = token.split(".");
    if (!id || !encoded || !signature || extra !== undefined || token.length > 512_000) throw new Error();
    const { key } = inboxKey(id);
    const expected = createHmac("sha256", key).update(`inbox-cursor:v1:${id}:${encoded}`).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || given.toString("base64url") !== signature || !timingSafeEqual(given, expected)) throw new Error();
    const packet = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, packet.subarray(0, 12));
    decipher.setAAD(Buffer.from("inbox-cursor:v1"));
    decipher.setAuthTag(packet.subarray(-16));
    return schema.parse(JSON.parse(Buffer.concat([decipher.update(packet.subarray(12, -16)), decipher.final()]).toString("utf8")));
  } catch {
    throw publishConflict("INBOX_CURSOR_INVALID");
  }
}

export function matchesFingerprint(reply: TransientReply, fingerprint: string) {
  const expected = Buffer.from(fingerprint);
  const actual = Buffer.from(inboxFingerprint(fingerprintFields(reply), fingerprint.slice(0, fingerprint.lastIndexOf(":"))));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
