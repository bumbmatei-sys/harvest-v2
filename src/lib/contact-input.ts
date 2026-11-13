import { message } from "../i18n/messages";
import { z } from "zod";
import { staffConsentPurposes } from "./consent-purposes";
export const uuidInput = z.uuid();
/** E.164-style: separators removed, no country guessed. */
export const phoneField = z.string().trim().max(40).transform((value) => value.replace(/[\s().-]/g, "")).refine((value) => !value || /^\+[1-9][0-9]{6,14}$/.test(value), message("Errors.useAnInternationalPhoneNumberStartingWith"));
export const socialField = z.string().trim().max(100).refine((value) => !value || /^@?[a-z0-9_][a-z0-9_.:-]*$/i.test(value), message("Errors.useAHandleWithoutSpacesOptionallyStartingWith"));
export const contactInput = z.object({
  name: z.string().trim().min(1).max(100), notes: z.string().trim().max(5000).default(""),
  email: z.union([z.email().max(254), z.literal("")]).default("").transform((value) => value.toLowerCase()),
  phone: z.string().default("").pipe(phoneField), social: z.string().default("").pipe(socialField),
}).strict();
export type ContactInput = z.input<typeof contactInput>;
// HC-DEC1: derived from the one purpose registry (legacy_unspecified is history only and can never be recorded).
export const consentPurposes = staffConsentPurposes;
export const consentNoticeVersions = ["notice-v1"] as const;
export const erasureInput = z.object({ confirm: z.literal("erase") }).strict();
export const consentInput = z.object({
  channel: z.enum(["email", "sms", "social"]), status: z.enum(["granted", "withdrawn", "unknown"]),
  purpose: z.enum(consentPurposes), noticeVersion: z.enum(consentNoticeVersions),
  occurredAt: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) <= Date.now() + 5 * 60_000, message("Errors.consentTimeCannotBeMoreThanFiveMinutes")).optional(),
  source: z.string().trim().min(1).max(200), evidence: z.string().trim().min(1).max(2000),
}).strict();
export type ConsentInput = z.input<typeof consentInput>;
export const contactQuery = z.object({ q: z.string().trim().max(100).default(""), page: z.coerce.number().int().min(1).max(100000).default(1) });
