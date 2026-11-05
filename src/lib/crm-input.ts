import { message } from "../i18n/messages";
import { z } from "zod";
import { contactInput, phoneField, socialField } from "./contact-input";

export const CRM_PAGE_SIZE = 20;
/** Twenty uses a three-character floor before suggesting duplicates; so do we. */
export const DUPLICATE_MIN_LENGTH = 3;

/** Same rule as the generated SQL columns: trim, collapse whitespace, lower-case. */
export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Reduce a pasted website or address to a comparable host: no scheme, credentials,
 * port, path, trailing dot or leading "www.". IDNs become punycode via WHATWG URL.
 * Returns null for empty input and undefined for something that is not a domain.
 */
export function normalizeDomain(value: string): string | null | undefined {
  const raw = value.trim();
  if (!raw) return null;
  if (/\s/.test(raw) || raw.length > 300) return undefined;
  // Only web addresses: any other scheme (mailto:, javascript:, ...) or embedded credentials is not a domain.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw) && !/^https?:\/\//i.test(raw)) return undefined;
  let host: string;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (url.username || url.password) return undefined;
    host = url.hostname;
  } catch { return undefined; }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (host.length > 253 || /^\d+(\.\d+){3}$/.test(host) || host.startsWith("[")) return undefined;
  const label = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
  return new RegExp(`^${label}(\\.${label})+$`).test(host) ? host : undefined;
}

const domainField = z.string().max(300).transform((value, context) => {
  const domain = normalizeDomain(value);
  if (domain === undefined) { context.addIssue({ code: "custom", message: message("Errors.enterAValidCompanyDomain") }); return z.NEVER; }
  return domain;
});
const companyName = z.string().trim().min(1).max(100);
const companyDescription = z.string().trim().max(2000);
const version = z.number().int().min(1);

export const companyInput = z.object({ name: companyName, domain: z.string().default("").pipe(domainField), description: companyDescription.default("") }).strict();
export type CompanyInput = z.input<typeof companyInput>;
export const companyPatch = z.object({ name: companyName.optional(), domain: domainField.optional(), description: companyDescription.optional(), version }).strict();
export type CompanyPatch = z.input<typeof companyPatch>;

const contactShape = contactInput.shape;
export const contactPatch = z.object({
  name: contactShape.name.optional(), notes: z.string().trim().max(5000).optional(),
  email: z.union([z.email().max(254), z.literal("")]).transform((value) => value.toLowerCase()).optional(),
  phone: phoneField.optional(), social: socialField.optional(), version,
}).strict();
export type ContactPatch = z.input<typeof contactPatch>;
export const newContactInput = contactInput.extend({ companyId: z.uuid().optional(), title: z.string().trim().max(100).default("") }).strict();
export type NewContactInput = z.input<typeof newContactInput>;

export const linkInput = z.object({ companyId: z.uuid(), title: z.string().trim().max(100).default(""), isPrimary: z.boolean().default(false) }).strict();
export type LinkInput = z.input<typeof linkInput>;
export const linkPatch = z.object({ title: z.string().trim().max(100).optional(), isPrimary: z.literal(true).optional() }).strict()
  .refine((value) => value.title !== undefined || value.isPrimary !== undefined);
export type LinkPatch = z.input<typeof linkPatch>;

const page = z.coerce.number().int().min(1).max(100000).default(1);
const q = z.string().trim().max(100).default("");
export const peopleSorts = ["name", "-name", "-created", "created", "-updated"] as const;
export const marketingStates = ["granted", "withdrawn", "none"] as const;
export const peopleQuery = z.object({
  q, page, sort: z.enum(peopleSorts).default("name"),
  company: z.union([z.uuid(), z.enum(["any", "none"])]).optional(),
  email: z.enum(["with", "without"]).optional(),
  marketing: z.enum(marketingStates).optional(),
});
export type PeopleQuery = z.input<typeof peopleQuery>;
export const companySorts = ["name", "-name", "-created", "created", "-people"] as const;
export const companyQuery = z.object({
  q, page, sort: z.enum(companySorts).default("name"),
  people: z.enum(["any", "none"]).optional(),
  domain: z.enum(["with", "without"]).optional(),
});
export type CompanyQuery = z.input<typeof companyQuery>;
