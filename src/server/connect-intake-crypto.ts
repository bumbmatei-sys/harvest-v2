import { createCipheriv, createDecipheriv, createHmac, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

function key(purpose: string) {
  const secret = process.env.HARVEST_CONNECT_TEST_KEY;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("CONNECT_KEY_UNAVAILABLE");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "hex"), "Harvest Connect", purpose, 32));
}
export const receiptHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const intakeFingerprint = (value: unknown) => createHmac("sha256", key("intake-fingerprint:v1")).update(JSON.stringify(value)).digest("hex");
export function sealIntake(value: unknown, binding: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key("pending-intake:v1"), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, binding, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

// Fresh submission proof bounds replay suppression to ten minutes, including after an early
// purge/erase. It is source+immutable-version bound and contains no person/contact information.
export function issueIntakeCapability(kind: string, code: string, stamp: string, now = Date.now()) {
  const prefix = `${now}.${randomBytes(16).toString("hex")}`;
  const mac = createHmac("sha256", key("submission-capability:v1")).update(`${kind}:${code}:${stamp}:${prefix}`).digest("hex");
  return `${prefix}.${mac}`;
}
export function verifyIntakeCapability(token: string, kind: string, code: string, stamp: string, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d{13}$/.test(parts[0]) || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
  const issued = Number(parts[0]), until = issued + 600_000;
  if (issued > now || until <= now) return null;
  const mac = createHmac("sha256", key("submission-capability:v1")).update(`${kind}:${code}:${stamp}:${parts[0]}.${parts[1]}`).digest();
  return timingSafeEqual(mac,Buffer.from(parts[2],"hex")) ? new Date(until).toISOString() : null;
}

// Only the invitation dispatcher/request service opens envelopes; no public decrypt endpoint.
export function openIntake(envelope: ReturnType<typeof sealIntake>, expectedBinding: string) {
 if(envelope.version!==1 || envelope.binding!==expectedBinding)throw new Error("INVALID_ENVELOPE");
 const cipher=createDecipheriv("aes-256-gcm",key("pending-intake:v1"),Buffer.from(envelope.iv,"base64"));
 cipher.setAAD(Buffer.from(expectedBinding));cipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,"base64")),cipher.final()]).toString("utf8")) as unknown;
}
export const invitationRecipientHash=(email:string,binding:string)=>createHmac("sha256",key("invitation-recipient:v1")).update(JSON.stringify([binding,email.toLowerCase()])).digest("hex");
