import { z } from "zod";
import { workerSettings } from "./worker-settings";

const kekFormat = /^[a-f0-9]{64}$/i;
const base64 = (value: ArrayBuffer | Uint8Array) => Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString("base64");
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
const text = new TextEncoder();
const versions = ["v1", "v2"] as const;
const versionSchema = z.enum(versions);
export const contactEnvelopeSchema = z.object({
  version: z.literal(3), keyVersion: versionSchema, binding: z.string().min(1).max(300),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  wrapIv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  wrappedKey: z.string().regex(/^[A-Za-z0-9+/]{64}$/),
}).strict();
export type ContactEnvelope = z.infer<typeof contactEnvelopeSchema>;
type KekVersion = ContactEnvelope["keyVersion"];
type KeyEnvironment = { CONTACT_KEK_V1?: string; CONTACT_KEK_V2?: string };

function contactKeys(env: KeyEnvironment = workerSettings.getStore()?.contactKeys ?? {
  CONTACT_KEK_V1: process.env.CONTACT_KEK_V1, CONTACT_KEK_V2: process.env.CONTACT_KEK_V2,
}) {
  const { CONTACT_KEK_V1: v1, CONTACT_KEK_V2: v2 } = env;
  if (!v1 && !v2) return null;
  if (v1 !== undefined && !kekFormat.test(v1) || v2 !== undefined && !kekFormat.test(v2) ||
      v1 !== undefined && v2 !== undefined && v1.toLowerCase() === v2.toLowerCase()) throw new Error("CONTACT_KEY_CONFIGURATION_INVALID");
  return { keys: { v1, v2 }, current: v2 ? "v2" as const : "v1" as const };
}
const requiredKeys = (env?: KeyEnvironment) => {
  const config = contactKeys(env);
  if (!config) throw new Error("CONTACT_KEY_UNAVAILABLE");
  return config;
};
type KeyConfig = ReturnType<typeof requiredKeys>;
export const contactKeyVersion = (env?: KeyEnvironment) => contactKeys(env)?.current;

async function wrappingKey(config: KeyConfig, version: KekVersion) {
  const secret = config.keys[version];
  if (!secret) throw new Error("CONTACT_KEY_UNAVAILABLE");
  return crypto.subtle.importKey("raw", Uint8Array.from(Buffer.from(secret, "hex")), "AES-GCM", false, ["wrapKey", "unwrapKey"]);
}
const dataParameters = (binding: string, iv: Uint8Array<ArrayBuffer>) =>
  ({ name: "AES-GCM", iv, additionalData: text.encode(JSON.stringify(["contact-data", binding])) });
const wrapParameters = (binding: string, version: KekVersion, iv: Uint8Array<ArrayBuffer>) =>
  ({ name: "AES-GCM", iv, additionalData: text.encode(JSON.stringify(["contact-wrap", binding, version])) });

async function wrap(dataKey: CryptoKey, binding: string, config: KeyConfig) {
  const keyVersion = config.current;
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.wrapKey("raw", dataKey, await wrappingKey(config, keyVersion), wrapParameters(binding, keyVersion, wrapIv));
  return { keyVersion, wrapIv: base64(wrapIv), wrappedKey: base64(wrappedKey) };
}

async function unwrap(envelope: ContactEnvelope, config: KeyConfig, extractable: boolean) {
  const { binding, keyVersion, wrapIv, wrappedKey } = envelope;
  return crypto.subtle.unwrapKey("raw", bytes(wrappedKey), await wrappingKey(config, keyVersion),
    wrapParameters(binding, keyVersion, bytes(wrapIv)), "AES-GCM", extractable, ["decrypt"]);
}

export async function sealContactEnvelope(value: unknown, binding: string, env?: KeyEnvironment): Promise<ContactEnvelope> {
  const config = requiredKeys(env);
  const dataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(dataParameters(binding, iv), dataKey, text.encode(JSON.stringify(value)));
  return { version: 3, binding, iv: base64(iv), ciphertext: base64(ciphertext), ...await wrap(dataKey, binding, config) };
}

// Imported only by the audited staging opener. Durable authorization precedes release of its input.
export async function openContactEnvelope(value: ContactEnvelope, expectedBinding: string, env?: KeyEnvironment): Promise<unknown> {
  const envelope = contactEnvelopeSchema.parse(value);
  if (envelope.binding !== expectedBinding) throw new Error("CONTACT_ENVELOPE_INVALID");
  const key = await unwrap(envelope, requiredKeys(env), false);
  const opened = await crypto.subtle.decrypt(dataParameters(expectedBinding, bytes(envelope.iv)), key, bytes(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(opened));
}

export async function rewrapContactEnvelope(value: ContactEnvelope, env?: KeyEnvironment): Promise<ContactEnvelope> {
  const envelope = contactEnvelopeSchema.parse(value);
  const config = requiredKeys(env);
  if (envelope.keyVersion === config.current) return envelope;
  if (Number(envelope.keyVersion[1]) > Number(config.current[1])) throw new Error("CONTACT_KEY_CONFIGURATION_INVALID");
  return { ...envelope, ...await wrap(await unwrap(envelope, config, true), envelope.binding, config) };
}
