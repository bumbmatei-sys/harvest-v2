import { getKeyProvider } from "../connect-key-provider";

// The webhook signing secret is derived by the key provider (purpose social-webhook:v1), never stored. Current and retired
// key ids are all accepted for verification so a rotation does not drop deliveries. The current key must resolve (fail closed);
// a retired id that no longer resolves is skipped.
export function webhookSecrets(): string[] {
  const provider = getKeyProvider(), purpose = "social-webhook:v1" as const;
  const secrets = [provider.resolveKey(purpose, provider.currentKeyId(purpose)).toString("hex")];
  for (const id of provider.retiredKeyIds(purpose)) { try { secrets.push(provider.resolveKey(purpose, id).toString("hex")); } catch { /* retired and gone */ } }
  return secrets;
}
