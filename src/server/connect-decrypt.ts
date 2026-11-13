import { envelopeKeyId, openIntake, type SealedEnvelope } from "./connect-intake-crypto";

// HC-DEC5: the single audited path for opening contact-detail envelopes.
// Restricted decryption: only the invitation request/claim/dispatch paths and key rotation call this function.
export type DecryptPurpose = "invitation-request" | "invitation-claim" | "invitation-dispatch" | "key-rotation";
/** Counts-only event: never carries a binding, envelope or decrypted value. */
export type DecryptAuditEvent = { purpose: DecryptPurpose; keyId: string; envelopeVersion: number; outcome: "ok" | "failed" };
export type DecryptAuditSink = (event: DecryptAuditEvent) => void;

const counts = new Map<string, number>();
const countingSink: DecryptAuditSink = (e) => { const k = `${e.purpose}:${e.outcome}`; counts.set(k, (counts.get(k) ?? 0) + 1); };
let sink: DecryptAuditSink = countingSink;
/** Replace the sink (a durable sink needs a later migration). Pass null to restore the in-process counter. */
export const setDecryptAuditSink = (next: DecryptAuditSink | null) => { sink = next ?? countingSink; };
export const decryptAuditCounts = () => Object.fromEntries(counts);
export const resetDecryptAuditCounts = () => counts.clear();

const safeKeyId = (envelope: SealedEnvelope) => {
  try { const id = envelopeKeyId(envelope); return typeof id === "string" && /^[a-z0-9._-]{1,32}$/.test(id) ? id : "invalid"; } catch { return "invalid"; }
};

/** Fails closed: if the audit sink throws, the decrypted value is discarded and the call throws. */
export function decryptContactDetails(envelope: SealedEnvelope, binding: string, purpose: DecryptPurpose, auditSink: DecryptAuditSink = sink): unknown {
  const base = { purpose, keyId: safeKeyId(envelope), envelopeVersion: Number(envelope?.version) };
  let value: unknown;
  try { value = openIntake(envelope, binding); }
  catch (error) {
    try { auditSink({ ...base, outcome: "failed" }); } catch { /* the original failure is the one that matters */ }
    throw error;
  }
  try { auditSink({ ...base, outcome: "ok" }); } catch { throw new Error("DECRYPT_AUDIT_UNAVAILABLE"); }
  return value;
}
