import type { Pool } from "pg";
import { type StagedContactEnvelope, openAuditedStagedContact } from "./connect-decrypt";
import { contactKeyVersion, rewrapContactEnvelope, sealContactEnvelope } from "./contact-envelope";

type StagedRow = { tenant_id: string; response_id: string; envelope: StagedContactEnvelope };
type KeyEnvironment = { CONTACT_KEK_V1?: string; CONTACT_KEK_V2?: string };

export async function rotateStagedContacts(pool: Pool, env: KeyEnvironment, mode: "run" | "check") {
  const version = contactKeyVersion(env);
  if (!version) throw new Error("CONTACT_KEY_UNAVAILABLE");
  const batchSize = 100;
  let cursor: StagedRow | undefined;
  let changed = 0, failed = 0, conflicted = 0;
  for (let batch = 0; mode === "run" && batch < 100; batch++) {
    // The definer commits a counts-only audit of legacy values before they can be opened.
    const { rows } = await pool.query<StagedRow>("select * from public.connect_contact_rotation_page($1, $2, $3, $4)",
      [cursor?.tenant_id, cursor?.response_id, version, batchSize]);
    for (const { tenant_id, response_id, envelope } of rows) {
      try {
        const next = envelope.version === 3
          ? await rewrapContactEnvelope(envelope, env)
          : await sealContactEnvelope(await openAuditedStagedContact(envelope, "key-rotation"), envelope.binding, env);
        const { rows: [row] } = await pool.query<{ replaced: boolean }>(
          "select public.connect_contact_rotation_replace($1, $2, $3, $4) as replaced", [tenant_id, response_id, envelope, next]);
        if (row.replaced) changed++;
        else conflicted++;
      } catch {
        failed++;
      }
    }
    if (rows.length < batchSize) break;
    cursor = rows.at(-1);
  }
  const { rows: [row] } = await pool.query<{ remaining: string }>("select public.connect_contact_rotation_remaining($1) remaining", [version]);
  return { changed, failed, conflicted, remaining: Number(row.remaining) };
}
