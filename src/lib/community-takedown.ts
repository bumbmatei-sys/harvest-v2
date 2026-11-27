import { z } from "zod";

// Reports to Harvest (founder, 27 Nov): a community from its public page, or a post or reply from the member area. Distinct from reports to the
// community's own hosts (lib/moderation). Staff admins hide and restore; nothing is sent to the reporter, the ministry or the author.
export const harvestReportReasons = ["spam", "harassment", "inappropriate", "impersonation", "scam", "other"] as const;
export type HarvestReportReason = typeof harvestReportReasons[number];
export const harvestReportTargets = ["community", "post", "comment"] as const;
export type HarvestReportTarget = typeof harvestReportTargets[number];
export const harvestReportNoteMax = 500;

const note = z.string().max(harvestReportNoteMax).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).transform((value) => value.trim() || null).optional();
/** A visitor's report of a public community page. `website` is a honeypot. */
export const communityHarvestReportSchema = z.object({ reason: z.enum(harvestReportReasons), note, website: z.string().max(200).optional() }).strict();
/** A member's report of a post or reply they can read. */
export const contentHarvestReportSchema = z.object({ targetType: z.enum(["post", "comment"]), targetId: z.uuid(), reason: z.enum(harvestReportReasons), note }).strict();
/** A staff admin hides (a reason is required) or restores one reported community, post or reply. */
export const takedownSchema = z.object({ targetType: z.enum(harvestReportTargets), targetId: z.uuid(), hidden: z.boolean(), reason: z.string().trim().min(1).max(500).optional() })
  .strict().refine((v) => !v.hidden || v.reason !== undefined);
