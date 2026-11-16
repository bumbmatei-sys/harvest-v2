import { can } from "@/lib/permissions";

export type ConsentStatus = "granted" | "withdrawn" | "unknown";
/** Which consent controls a role may see. UI visibility only: recordConsent enforces the same permissions on the server. */
export function consentControls(role: string) {
  const canGrant = can(role, "contacts:attest_consent"), canWithdraw = can(role, "contacts:record_withdrawal");
  const statuses: ConsentStatus[] = [...(canGrant ? ["unknown", "granted"] as const : []), ...(canWithdraw ? ["withdrawn"] as const : [])];
  return { canGrant, canWithdraw, statuses, canRecord: statuses.length > 0 };
}

/** Row buttons for one purpose: granted offers a withdrawal; withdrawn an opt-in; with nothing recorded, both (each by permission), so an opt-out received first can be recorded from the row. */
export function rowActions(state: "granted" | "withdrawn" | "none", controls: { canGrant: boolean; canWithdraw: boolean }): ("granted" | "withdrawn")[] {
  if (state === "granted") return controls.canWithdraw ? ["withdrawn"] : [];
  if (state === "withdrawn") return controls.canGrant ? ["granted"] : [];
  return [...(controls.canGrant ? ["granted"] as const : []), ...(controls.canWithdraw ? ["withdrawn"] as const : [])];
}
