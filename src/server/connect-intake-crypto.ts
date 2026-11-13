import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { LEGACY_KEY_ID, getKeyProvider, type KeyPurpose } from "./connect-key-provider";

// Keys come from the KeyProvider (HC-DEC5). Hashes and capabilities always use the current key id.
const key = (purpose: KeyPurpose) => { const p = getKeyProvider(); return p.resolveKey(purpose, p.currentKeyId(purpose)); };
export const receiptHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const intakeFingerprint = (value: unknown) => createHmac("sha256", key("intake-fingerprint:v1")).update(JSON.stringify(value)).digest("hex");
// Version 1 envelopes carry no key id. Version 2 envelopes record the key id they were sealed under.
type EnvelopeBody = { binding: string; iv: string; tag: string; ciphertext: string };
export type SealedEnvelope = (EnvelopeBody & { version: 1 }) | (EnvelopeBody & { version: 2; keyId: string });
export const envelopeKeyId = (envelope: SealedEnvelope) => envelope.version === 2 ? envelope.keyId : LEGACY_KEY_ID;
function seal(value: unknown, binding: string, keyId: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", getKeyProvider().resolveKey("pending-intake:v1", keyId), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { binding, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
export function sealIntake(value: unknown, binding: string) {
  const keyId = getKeyProvider().currentKeyId("pending-intake:v1");
  return { version: 2 as const, keyId, ...seal(value, binding, keyId) };
}
// The stored pending-intake definer functions (migrations 0028, 0029, 0032) pin version 1 and an exact key set, so
// the receipt path keeps sealing version 1 under the legacy key until a migration accepts version 2.
export const sealIntakeV1 = (value: unknown, binding: string) => ({ version: 1 as const, ...seal(value, binding, LEGACY_KEY_ID) });

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

// Raw opener, no audit. Only connect-decrypt.ts may import it; tests/unit/connect-crypto-guard.test.ts enforces that.
export function openIntake(envelope: SealedEnvelope, expectedBinding: string) {
 if((envelope.version!==1 && envelope.version!==2) || envelope.binding!==expectedBinding)throw new Error("INVALID_ENVELOPE");
 const keyId=envelopeKeyId(envelope);
 if(typeof keyId!=="string")throw new Error("INVALID_ENVELOPE");
 const cipher=createDecipheriv("aes-256-gcm",getKeyProvider().resolveKey("pending-intake:v1",keyId),Buffer.from(envelope.iv,"base64"));
 cipher.setAAD(Buffer.from(expectedBinding));cipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,"base64")),cipher.final()]).toString("utf8")) as unknown;
}
export const invitationRecipientHash=(email:string,binding:string)=>createHmac("sha256",key("invitation-recipient:v1")).update(JSON.stringify([binding,email.toLowerCase()])).digest("hex");
