import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getKeyProvider } from "../connect-key-provider";
import type { SocialCredential } from "./types";

// Provider credentials are stored only as AES-256-GCM envelopes under the key provider (purpose social-credential:v1).
// The AAD binds an envelope to its tenant and connection, so a copied envelope cannot be opened under another row.
// The envelope records its key id, so rotation is possible without re-reading the plaintext elsewhere.
export type CredentialEnvelope = { version: 1; keyId: string; binding: string; iv: string; tag: string; ciphertext: string };
const PURPOSE = "social-credential:v1" as const;
export const credentialBinding = (tenantId: string, connectionId: string) => `social-credential:${tenantId}:${connectionId}`;

export function sealCredential(credential: SocialCredential, binding: string): CredentialEnvelope {
  const provider = getKeyProvider(), keyId = provider.currentKeyId(PURPOSE), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", provider.resolveKey(PURPOSE, keyId), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ secret: credential.secret }), "utf8"), cipher.final()]);
  return { version: 1, keyId, binding, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
/** Opens an envelope for one provider call. The result must never be logged, audited, stored or returned. */
export function openCredential(envelope: unknown, expectedBinding: string): SocialCredential {
  const e = envelope as Partial<CredentialEnvelope> | null;
  if (!e || e.version !== 1 || e.binding !== expectedBinding || typeof e.keyId !== "string" || typeof e.iv !== "string" || typeof e.tag !== "string" || typeof e.ciphertext !== "string") throw new Error("INVALID_ENVELOPE");
  const decipher = createDecipheriv("aes-256-gcm", getKeyProvider().resolveKey(PURPOSE, e.keyId), Buffer.from(e.iv, "base64"));
  decipher.setAAD(Buffer.from(expectedBinding)); decipher.setAuthTag(Buffer.from(e.tag, "base64"));
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.ciphertext, "base64")), decipher.final()]).toString("utf8")) as { secret?: unknown };
  if (typeof parsed.secret !== "string" || !parsed.secret) throw new Error("INVALID_ENVELOPE");
  return { secret: parsed.secret };
}
