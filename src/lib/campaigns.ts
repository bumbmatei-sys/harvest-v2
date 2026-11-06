import { z } from "zod";

export const campaignTypes = ["evangelistic_crusade", "mission_trip", "conference", "local_outreach", "custom_project"] as const;
export const campaignStructures = ["single", "multi", "online_hybrid"] as const;
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((value) => value || null);
const optionalDate = z.iso.date().nullish().transform((value) => value ?? null);

// Status and owner are server controlled. Unfinished drafts may omit location/dates.
export const campaignInput = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(campaignTypes),
  description: optionalText(5000),
  mission: optionalText(5000),
  country: optionalText(100),
  cityRegion: optionalText(200),
  startDate: optionalDate,
  endDate: optionalDate,
  timeZone: optionalText(100).refine((value) => {
    if (value === null) return true;
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }),
  structure: z.enum(campaignStructures).nullable().optional().transform((value) => value ?? null),
}).strict().refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, { path: ["endDate"], message: "INVALID_DATE_RANGE" });
export type CampaignInput = z.input<typeof campaignInput>;
export const campaignIdempotencyKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
export const campaignPage = z.coerce.number().int().min(1).max(10000).default(1);
export const CAMPAIGN_PAGE_SIZE = 20;
