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

/** Channel a consent action lands on by default for each purpose a permission card can show. */
const purposeChannel = { messaging: "social", form_follow_up: "email", newsletter: "email", outreach_follow_up: "email" } as const;
export type PermissionPurpose = keyof typeof purposeChannel;
/**
 * Preset for the consent dialog opened from a permission row. An opt-in must land on the withdrawn channel to clear that withdrawal;
 * a withdrawal goes where the grant is; with nothing recorded the purpose's own channel is used.
 */
export function permissionPreset(purpose: PermissionPurpose, current: { status: "granted" | "withdrawn" | "none"; channel: "email" | "sms" | "social" | null }, status: "granted" | "withdrawn") {
  return { purpose, status, channel: current.status !== "none" && current.channel ? current.channel : purposeChannel[purpose] };
}
