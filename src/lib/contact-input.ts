import { z } from "zod";
export const uuidInput = z.uuid();
export const contactInput = z.object({
  name: z.string().trim().min(1).max(100), notes: z.string().trim().max(5000).default(""),
  email: z.union([z.email().max(254), z.literal("")]).default("").transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(40).default("").transform((value) => value.replace(/[\s().-]/g, "")).refine((value) => !value || /^\+[1-9][0-9]{6,14}$/.test(value), "Use an international phone number, starting with +."),
  social: z.string().trim().max(100).default("").refine((value) => !value || /^@?[a-z0-9_][a-z0-9_.:-]*$/i.test(value), "Use a handle without spaces, optionally starting with @."),
}).strict();
export type ContactInput = z.input<typeof contactInput>;
export const consentInput = z.object({
  channel: z.enum(["email", "sms", "social"]), status: z.enum(["granted", "withdrawn", "unknown"]),
  source: z.string().trim().min(1).max(200), evidence: z.string().trim().min(1).max(2000),
}).strict();
export type ConsentInput = z.input<typeof consentInput>;
export const contactQuery = z.object({ q: z.string().trim().max(100).default(""), page: z.coerce.number().int().min(1).max(100000).default(1) });
