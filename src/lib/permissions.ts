// Pure role → permission rules. No runtime imports beyond the pure access-area table, so server code and client components share one source of truth.
import { collaboratorCan, parseRoleToken } from "./access-areas";
// `member` and `viewer` keep exactly their original rules. `collaborator` (a per-area access set) and `guest` (shared items only) are the
// per-feature roles; `campaign_guest` is the same inert role the campaign invitations use (see docs/acceptance/feature-access-server.md).
export const roleIds = ["owner", "admin", "member", "viewer", "collaborator", "guest"] as const;
export type Role = typeof roleIds[number];
export type Permission = "workspace:read" | "members:write" | "roles:write" | "contacts:read" | "contacts:write" | "settings:write" | "contacts:erase" | "jobs:read" | "jobs:operate" | "companies:read" | "companies:write" | "crm:fields_write" | "opportunities:read" | "opportunities:write" | "crm:pipelines_write" | "tasks:read" | "tasks:write" | "notes:read" | "notes:write"
  // CRM-06: imports and exports run for writers; merging and the sensitive export columns are owner/admin.
  | "campaigns:read" | "campaigns:write" | "campaigns:activate" | "crm:import" | "crm:export" | "crm:export_sensitive" | "contacts:merge"
  // CRM-08: outbound webhook endpoints are owner/admin configuration.
  | "webhooks:manage" | "crm:read_diagnostics"
  // HC-02: restricted pending Connect responses (metadata, withdrawal, erasure, retention) are owner/admin.
  | "connect:privacy"
  // HC-03: publishing, disabling, rotating and archiving a public QR/short-URL link is owner/admin,
  // like publishing Forms versions and privacy notices. Drafts, preview and export use campaigns:write.
  | "connect:publish" | "contacts:sources_read"
  // ADR 0013: every ministry role can see its communities list; owners/admins create and manage them.
  | "communities:read" | "communities:manage"
  // HC-DEC1b: attesting consent on a person's behalf (a grant, or an 'unknown' status) is owner/admin only.
  // Follow-up to HC-DEC1b: recording a WITHDRAWAL on a person's behalf (an opt-out someone received) is open to every non-viewer member, so an
  // opt-out is never held up waiting for an owner or admin. It can only ever narrow what we may send; it grants nothing.
  | "contacts:attest_consent" | "contacts:record_withdrawal"
  // HC-13: follow-up cases. Managing (open, assign, any legal transition, every case) is owner/admin. Working (own assigned open cases) is any
  // non-viewer member; the database policy and definers additionally require the assignment, so this key alone grants no case.
  | "followup:manage" | "followup:work"
  // Social provider integration layer: linking accounts, scheduling posts and reading the inbox are owner/admin until a wider role is decided.
  | "ads:manage"
  | "social:approvals" | "social:approvals_settings"
  | "social:connect" | "social:schedule" | "social:analytics" | "social:auto_dm" | "social:inbox" | "social:reply" | "social:assign" | "social:saved_replies"
  | "office:connect" | "office:mail" | "office:calendar" | "office:files"
  // Live staff capabilities; community membership is resolved separately.
  | "community:live:view" | "community:live:manage" | "community:live:moderate"
  | "catalog:manage" | "catalog:read"
  // CRM forms builder: building and saving form drafts is owner/admin (the same roles the forms tables allow).
  | "crm:forms_manage"
  // CRM reports: read-only aggregates. Owners and admins see ministry totals, members only their own work; viewers see nothing.
  | "crm:reports"
  // Downloading a report table as CSV (aggregates only): owners and admins, a deliberate step above reading the screen.
  | "crm:reports_export"
  // Docs: every role reads; owners, admins and members create docs and edit the ones they own (database policy); owners and admins manage all.
  | "docs:read" | "docs:write" | "docs:manage"
  // Link in bio: owners and admins only (the page, its clicks and its messages).
  | "bio:manage"
  // Native blog: owners and admins (a collaborator with Website at manage). Members and viewers never see a draft.
  | "blog:manage"
  // Ways to give (CW-10): the ministry's own giving accounts. Owners and admins (a collaborator with Giving at manage).
  | "giving:manage"
  | "newsletter:read" | "newsletter:manage" | "newsletter:campaigns" | "newsletter:delivery" | "newsletter:analytics"
  // Fundraising pledge campaigns: owners and admins. Campaign settings follow the Giving area; pledges, gifts and supporter details stay owner/admin only.
  | "fundraising:read" | "fundraising:manage" | "fundraising:publish" | "giving:record" | "giving:correct" | "giving:read_donors";
function legacyCan(role: string, permission: Permission): boolean {
  if (permission === "communities:read" || permission === "workspace:read" || permission === "contacts:read" || permission === "companies:read" || permission === "opportunities:read" || permission === "tasks:read" || permission === "notes:read" || permission === "campaigns:read" || permission === "docs:read" || permission === "catalog:read") return roleIds.includes(role as Role);
  if (permission === "newsletter:read") return role === "owner" || role === "admin" || role === "member";
  if (permission === "followup:work" || permission === "contacts:record_withdrawal" || permission === "crm:reports" || permission === "docs:write") return role === "owner" || role === "admin" || role === "member";
  if (permission === "contacts:write" || permission === "companies:write" || permission === "opportunities:write" || permission === "tasks:write" || permission === "notes:write"
    || permission === "campaigns:write" || permission === "crm:import" || permission === "crm:export") return role === "owner" || role === "admin" || role === "member";
  // Approvals: owners and admins submit and decide; only an owner changes the ministry setting.
  if (permission === "social:approvals_settings") return role === "owner";
  return role === "owner" || role === "admin";
}

/**
 * The one capability rule for code. `role` is a stored role id, or a role token (`collaborator;crm=manage;social=view`, see access-areas.ts)
 * so a collaborator's grants travel with the role string through the existing `can(workspace.role, ...)` call sites.
 * Owners, admins, members, viewers and every unknown role behave exactly as before; a guest holds `workspace:read` only.
 */
export function can(role: string, permission: Permission): boolean {
  const token = parseRoleToken(role);
  if (token.role === "collaborator") return collaboratorCan(token.grants, permission, legacyCan);
  // A guest reads the account name and the docs list; the database then shows only docs shared with them by name (docs_rank).
  if (token.role === "guest" || token.role === "campaign_guest") return permission === "workspace:read" || permission === "docs:read";
  return legacyCan(token.role, permission);
}
/** Frozen reference to the original rules, used by the parity test and by the collaborator mapping (admin and viewer equivalents). */
export const legacyRules = legacyCan;
