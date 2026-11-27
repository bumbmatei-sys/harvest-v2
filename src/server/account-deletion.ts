import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import type { OfficeProvider } from "./office-provider/port";
import { OfficeProviderError, type Credential } from "./office-provider/types";
import { assertFreshSignIn } from "./platform/staff";
import { withUser } from "./tenancy";

/** The word the person types to confirm. The database checks it again. */
export const DELETE_CONFIRMATION = "DELETE";
/** Account deletion needs a sign-in within the last 15 minutes: the same rule as Harvest staff actions. */
export const DELETE_FRESH_SIGN_IN_MINUTES = 15;
export type SoleOwnerMinistry = { id: string; name: string };
type Outcome = { outcome: "deleted"; reference: string; fileKeys: string[] } | { outcome: "sole_owner"; ministries: SoleOwnerMinistry[] }
  | { outcome: "invalid" } | { outcome: "not_found" };
export type ObjectDeleter = { deleteObject(key: string): Promise<void> };
/** The mail and calendar provider used to revoke the person's connections; null where the integration is off (then no connection can exist). */
export type OfficeRevoker = { provider: Pick<OfficeProvider, "id" | "disconnect">; credential: Credential } | null;
type OfficeConnectionRow = { id: string; provider: string; kind: "mail" | "calendar" | "files"; ref: string; platform: "google" | "microsoft" | null; profileRef: string | null };

const transferSteps = (ministries: SoleOwnerMinistry[]) => ministries.map(({ id, name }) => ({
  id, name, transferEndpoint: `/api/workspaces/${id}/ownership-transfer`,
}));
const soleOwnerConflict = (ministries: SoleOwnerMinistry[]) => new AccessError(409, message("Errors.deleteAccountSoleOwner"), {
  code: "SOLE_OWNER", ministries: ministries.length, ownershipTransfers: transferSteps(ministries),
});
export async function accountDeletionBlockers(db: Database, userId: string) {
  return { ownershipTransfers: transferSteps(await soleOwnerMinistries(db, userId)) };
}

const disconnectFailed = () => new AccessError(409, message("Errors.deleteAccountDisconnectFailed"), { code: "OFFICE_DISCONNECT_FAILED" });
/**
 * Revoke every mail, calendar and files connection the person owns at its provider, before anything is deleted: Harvest keeps only an account
 * reference, the provider holds the grant. Any failure stops the deletion (fail closed) so no grant outlives its Harvest record; an account the
 * provider no longer knows counts as revoked. A connection whose provider is not configured here also stops it.
 */
async function revokeOfficeConnections(db: Database, userId: string, office: OfficeRevoker) {
  const rows = await withUser(db, userId, async (tx) => (await tx.execute<{ v: OfficeConnectionRow[] }>(sql`select public.account_office_connections() as v`)).rows[0].v);
  for (const row of rows) {
    if (!row.platform || !row.profileRef) continue;
    if (!office || office.provider.id !== row.provider) throw disconnectFailed();
    try { await office.provider.disconnect(office.credential, { ref: row.ref, platform: row.platform, kind: row.kind, profileRef: row.profileRef }); }
    catch (error) { if (!(error instanceof OfficeProviderError && error.code === "NOT_FOUND")) throw disconnectFailed(); }
  }
  return rows.length;
}

const deleteInput = z.object({ confirm: z.literal(DELETE_CONFIRMATION) }).strict();

/** The ministries the person is the only owner of; account deletion is refused until each has another owner or is deleted. */
export function soleOwnerMinistries(db: Database, userId: string) {
  return withUser(db, userId, async (tx) => (await tx.execute<{ v: SoleOwnerMinistry[] }>(sql`select public.account_delete_blockers() as v`)).rows[0].v);
}

/** Whether the session is recent enough to delete the account. */
export function signInIsFresh(signedInAt: Date | string | null | undefined, now = new Date()) {
  try { assertFreshSignIn(signedInAt, now, DELETE_FRESH_SIGN_IN_MINUTES); return true; } catch { return false; }
}

/**
 * Delete the signed-in person's account (policy pack §7 and §11). Public posts, replies and channel messages stay as "Former member"; DMs,
 * course progress and notes, memberships, the profile and every session are deleted; the account row stays as a scrubbed tombstone so audit
 * logs keep their reference. Uploads never attached to a post are removed from storage afterwards (best effort: their rows are already gone).
 */
export async function deleteMyAccount(db: Database, userId: string, signedInAt: Date | string | null | undefined, raw: unknown,
  deleter: ObjectDeleter | null, now = new Date(), office: OfficeRevoker = null) {
  assertFreshSignIn(signedInAt, now, DELETE_FRESH_SIGN_IN_MINUTES);
  const input = deleteInput.safeParse(raw);
  if (!input.success) throw new AccessError(400, message("Errors.deleteAccountConfirm"), { code: "CONFIRMATION_REQUIRED" });
  // Refuse a sole owner before revoking anything; the database checks again under lock.
  const blockers = await soleOwnerMinistries(db, userId);
  if (blockers.length) throw soleOwnerConflict(blockers);
  await revokeOfficeConnections(db, userId, office);
  const result = await withUser(db, userId, async (tx) => (await tx.execute<{ v: Outcome }>(sql`select public.account_delete(${input.data.confirm}) as v`)).rows[0].v);
  if (result.outcome === "sole_owner") throw soleOwnerConflict(result.ministries);
  if (result.outcome === "invalid") throw new AccessError(400, message("Errors.deleteAccountConfirm"), { code: "CONFIRMATION_REQUIRED" });
  if (result.outcome !== "deleted") throw new AccessError(404, message("Errors.accountNotFound"));
  let removed = 0;
  for (const key of result.fileKeys) {
    try { await deleter?.deleteObject(key); if (deleter) removed++; } catch { /* the row is gone; an orphaned object is unreachable and logged by count only */ }
  }
  if (removed < result.fileKeys.length) console.error("account_delete_objects_pending", { count: result.fileKeys.length - removed });
  return { reference: result.reference };
}
