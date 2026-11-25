import { leadStatuses, type LeadStatus } from "./ads";

// Browser side of the lead routes. A lead is personal data held as an ad-lead record until a person adds it to the CRM; nothing here sends or stores anything.
export type LeadView = { id: string; adAccountId: string; network: string; formRef: string | null; campaignRef: string | null; adRef: string | null; status: LeadStatus; fields: Record<string, string>;
  consentText: string | null; submittedAt: string | null; version: number; inCrm?: boolean };
export type DraftFormRow = { id: string; title: string; network: string; revision: number; versions: number; publishedVersions: number };
export const leadStatusList = leadStatuses;

/** What a person is called on the list, from the standard answers a form collects. */
export function leadName(fields: Record<string, string>): string {
  const full = fields.full_name?.trim();
  if (full) return full;
  return [fields.first_name, fields.last_name].map((v) => v?.trim()).filter(Boolean).join(" ");
}
export const leadContact = (fields: Record<string, string>) => [fields.email, fields.phone].map((v) => v?.trim()).filter(Boolean).join(" · ");
/** Leads that can still be added to the CRM: not already in it and with a way to reach the person. */
export const convertible = (lead: LeadView) => !lead.inCrm && Boolean(lead.fields.email?.trim() || lead.fields.phone?.trim());
export const filterLeads = (leads: readonly LeadView[], status: LeadStatus | "all") => status === "all" ? [...leads] : leads.filter((lead) => lead.status === status);
