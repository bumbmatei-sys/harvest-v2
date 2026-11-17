import { z } from "zod";
export const newsletterStates = ["subscribed", "unsubscribed", "bounced", "suppressed"] as const;
export type NewsletterState = typeof newsletterStates[number];
export function effectiveNewsletterState(stored: NewsletterState, suppressed: boolean, mayContact: boolean): NewsletterState {
    return suppressed || stored === 'suppressed' ? 'suppressed' : stored === 'subscribed' && !mayContact ? 'unsubscribed' : stored;
}
export const newsletterPage = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), after: z.uuid().optional(), tag: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/).optional(), segmentId: z.uuid().optional() }).strict();
export const subscriberInput = z.object({ contactId: z.uuid(), source: z.enum(['manual', 'csv_import']).default('manual'), importId: z.uuid().nullable().default(null), rowNumber: z.number().int().positive().nullable().default(null), tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)).max(50).transform(v => [...new Set(v)].sort()).default([]) }).strict().refine(v => v.source === 'manual' ? v.importId === null && v.rowNumber === null : v.importId !== null && v.rowNumber !== null);
export const subscriptionInput = z.object({ state: z.enum(newsletterStates), version: z.number().int().min(0) }).strict();
