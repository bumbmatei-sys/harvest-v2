import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
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
  deleter: ObjectDeleter | null, now = new Date()) {
  assertFreshSignIn(signedInAt, now, DELETE_FRESH_SIGN_IN_MINUTES);
  const input = deleteInput.safeParse(raw);
  if (!input.success) throw new AccessError(400, message("Errors.deleteAccountConfirm"), { code: "CONFIRMATION_REQUIRED" });
  const result = await withUser(db, userId, async (tx) => (await tx.execute<{ v: Outcome }>(sql`select public.account_delete(${input.data.confirm}) as v`)).rows[0].v);
  if (result.outcome === "sole_owner") throw new AccessError(409, message("Errors.deleteAccountSoleOwner"), { code: "SOLE_OWNER", ministries: result.ministries.length });
  if (result.outcome === "invalid") throw new AccessError(400, message("Errors.deleteAccountConfirm"), { code: "CONFIRMATION_REQUIRED" });
  if (result.outcome !== "deleted") throw new AccessError(404, message("Errors.accountNotFound"));
  let removed = 0;
  for (const key of result.fileKeys) {
    try { await deleter?.deleteObject(key); if (deleter) removed++; } catch { /* the row is gone; an orphaned object is unreachable and logged by count only */ }
  }
  if (removed < result.fileKeys.length) console.error("account_delete_objects_pending", { count: result.fileKeys.length - removed });
  return { reference: result.reference };
}
