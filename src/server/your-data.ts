import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { listSubjectResponses, type SubjectResponse } from "./connect-subject-rights";
import { AccessError } from "./permissions";
import type { StorageAdapter } from "./storage/adapter";
import { withUser } from "./tenancy";

/** Signed file links in the export stay valid for one hour. */
export const EXPORT_LINK_SECONDS = 3600;
const connectPages = 25;

type ExportFile = { id: string; name: string; key?: string | null; [field: string]: unknown };
type ExportData = Record<string, unknown> & { files: ExportFile[] };
type Outcome = { outcome: "ok"; data: ExportData; truncated: string[] } | { outcome: "limited"; retryAfter: number } | { outcome: "not_found" };

/** Connect responses the person claimed, with the purposes they agreed to. Unavailable while Connect intake is off; the export says so instead of failing. */
async function connectResponses(db: Database, userId: string): Promise<SubjectResponse[] | null> {
  const items: SubjectResponse[] = [];
  let after: string | undefined;
  try {
    for (let page = 0; page < connectPages; page++) {
      const result = await listSubjectResponses(db, userId, after);
      items.push(...result.items);
      if (!result.next) break;
      after = result.next;
    }
  } catch (error) {
    if (error instanceof AccessError) return null;
    throw error;
  }
  return items;
}

/**
 * "Download my data": everything Harvest holds about the signed-in person as a user, as one JSON document. Rate limited in the database (3 per
 * rolling hour). Files carry a signed link that expires after an hour; the storage key itself is never included.
 */
export async function exportMyData(db: Database, storage: StorageAdapter | null, userId: string, now = new Date()) {
  const result = await withUser(db, userId, async (tx) => (await tx.execute<{ v: Outcome }>(sql`select public.account_export() as v`)).rows[0].v);
  if (result.outcome === "limited") throw new AccessError(429, message("Errors.dataExportLimited"), { code: "EXPORT_LIMITED", retryAfter: result.retryAfter });
  if (result.outcome !== "ok") throw new AccessError(404, message("Errors.accountNotFound"));
  const expiresAt = new Date(now.getTime() + EXPORT_LINK_SECONDS * 1000).toISOString();
  const files = await Promise.all(result.data.files.map(async ({ key, ...file }) => {
    if (!key || !storage) return { ...file, link: null };
    try { return { ...file, link: await storage.presignDownload(key, file.name, { expiresIn: EXPORT_LINK_SECONDS }), linkExpiresAt: expiresAt }; }
    catch { return { ...file, link: null }; }
  }));
  return {
    format: "harvest-your-data", version: 1, generatedAt: now.toISOString(),
    ...result.data, files,
    consents: { connectResponses: await connectResponses(db, userId) },
    notes: {
      newsletters: message("YourData.newslettersNote"),
      truncated: result.truncated,
    },
  };
}

export const exportFileName = (now = new Date()) => `harvest-data-${now.toISOString().slice(0, 10)}.json`;
