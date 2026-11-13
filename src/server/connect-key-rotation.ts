import { decryptContactDetails, type DecryptAuditSink } from "./connect-decrypt";
import { envelopeKeyId, sealIntake, type SealedEnvelope } from "./connect-intake-crypto";
import { getKeyProvider } from "./connect-key-provider";

// HC-DEC5: re-seal stored envelopes under the current key id, in bounded batches.
// The store is injected. No production store exists yet: re-sealing needs a definer function and a migration (see docs/acceptance/hc-dec5-keys.md).
export type StoredEnvelope = { id: string; envelope: SealedEnvelope };
export interface EnvelopeStore {
  /** Rows after the cursor (null = start), ordered by id, at most `limit`. next is null when the end was reached. */
  list(after: string | null, limit: number): Promise<{ rows: StoredEnvelope[]; next: string | null }>;
  /** Compare-and-swap: replace only if the stored envelope still equals `from`. False when it changed or is gone. */
  replace(id: string, from: SealedEnvelope, to: SealedEnvelope): Promise<boolean>;
}
export type RotationCounts = { scanned: number; resealed: number; alreadyCurrent: number; conflicts: number; failed: number; batches: number; complete: boolean };
export const ROTATION_MAX_BATCH = 500;

/** Idempotent: envelopes already under the current key id are skipped. Output is counts only. */
export async function rotateEnvelopes(store: EnvelopeStore, options: { batchSize?: number; maxBatches?: number; auditSink?: DecryptAuditSink } = {}): Promise<RotationCounts> {
  const limit = Math.min(Math.max(Math.trunc(options.batchSize ?? 100) || 1, 1), ROTATION_MAX_BATCH);
  const maxBatches = Math.max(Math.trunc(options.maxBatches ?? 10) || 1, 1);
  const provider = getKeyProvider(), currentId = provider.currentKeyId("pending-intake:v1");
  const out: RotationCounts = { scanned: 0, resealed: 0, alreadyCurrent: 0, conflicts: 0, failed: 0, batches: 0, complete: false };
  let cursor: string | null = null;
  while (out.batches < maxBatches) {
    const page = await store.list(cursor, limit);
    out.batches++;
    for (const { id, envelope } of page.rows) {
      out.scanned++;
      if (envelopeKeyId(envelope) === currentId && envelope.version === 2) { out.alreadyCurrent++; continue; }
      try {
        const value = decryptContactDetails(envelope, envelope.binding, "key-rotation", options.auditSink);
        const next = sealIntake(value, envelope.binding);
        if (await store.replace(id, envelope, next)) out.resealed++; else out.conflicts++;
      } catch { out.failed++; }
    }
    if (!page.next) { out.complete = true; break; }
    cursor = page.next;
  }
  return out;
}
