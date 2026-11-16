import { can } from "@/lib/permissions";

export type ConsentStatus = "granted" | "withdrawn" | "unknown";
/** Which consent controls a role may see. UI visibility only: recordConsent enforces the same permissions on the server. */
export function consentControls(role: string) {
  const canGrant = can(role, "contacts:attest_consent"), canWithdraw = can(role, "contacts:record_withdrawal");
  const statuses: ConsentStatus[] = [...(canGrant ? ["unknown", "granted"] as const : []), ...(canWithdraw ? ["withdrawn"] as const : [])];
  return { canGrant, canWithdraw, statuses, canRecord: statuses.length > 0 };
}
