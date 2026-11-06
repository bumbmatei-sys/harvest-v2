import { z } from "zod";
import { phoneField, socialField } from "./contact-input";
import { normalizeDomain, normalizeName } from "./crm-input";
import { stripFormulaGuard } from "./csv";

export const importEntities = ["person", "company"] as const;
export type ImportEntity = typeof importEntities[number];
export const personTargets = ["name", "email", "phone", "social", "notes", "company", "title"] as const;
export const companyTargets = ["name", "domain", "description"] as const;
export type ImportTarget = typeof personTargets[number] | typeof companyTargets[number];
export const targetsFor = (entity: ImportEntity): readonly ImportTarget[] => (entity === "person" ? personTargets : companyTargets);
export const IMPORT_CHUNK = 200;
export const IMPORT_PREVIEW_PAGE = 50;

/**
 * Deterministic header suggestions: a header (lower-cased, separators removed) maps to a
 * target only through this list. Nothing fuzzy, so the same file always maps the same way.
 */
const synonyms: Record<ImportEntity, Record<string, string[]>> = {
  person: {
    name: ["name", "fullname", "person", "contact", "contactname", "displayname"],
    email: ["email", "emailaddress", "mail", "primaryemail"],
    phone: ["phone", "phonenumber", "mobile", "mobilephone", "telephone", "tel", "cell"],
    social: ["social", "handle", "socialhandle", "instagram", "twitter", "x"],
    notes: ["notes", "note", "comments", "comment"],
    company: ["company", "organization", "organisation", "church", "companyname", "employer", "companydomain"],
    title: ["title", "jobtitle", "role", "position"],
  },
  company: {
    name: ["name", "company", "companyname", "organization", "organisation", "church"],
    domain: ["domain", "website", "url", "web", "domainname", "site"],
    description: ["description", "about", "notes", "summary"],
  },
};
const squash = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
export function suggestMapping(entity: ImportEntity, headers: string[]): (ImportTarget | null)[] {
  const used = new Set<string>();
  return headers.map((header) => {
    const key = squash(header);
    const target = Object.entries(synonyms[entity]).find(([candidate, names]) => !used.has(candidate) && names.includes(key))?.[0];
    if (!target) return null;
    used.add(target);
    return target as ImportTarget;
  });
}

/** A mapping is valid when every target belongs to the entity, none repeats, and Name is mapped. */
export function mappingSchema(entity: ImportEntity, width: number) {
  const allowed = targetsFor(entity) as readonly string[];
  return z.array(z.string().nullable()).length(width).superRefine((mapping, context) => {
    const chosen = mapping.filter((value): value is string => value !== null);
    if (chosen.some((value) => !allowed.includes(value))) context.addIssue({ code: "custom", message: "unknown_target" });
    if (new Set(chosen).size !== chosen.length) context.addIssue({ code: "custom", message: "duplicate_target" });
    if (!chosen.includes("name")) context.addIssue({ code: "custom", message: "name_required" });
    if (entity === "person" && chosen.includes("title") && !chosen.includes("company")) context.addIssue({ code: "custom", message: "title_needs_company" });
  });
}
export const importPatch = z.object({ mapping: z.array(z.string().nullable()).optional(), onMatch: z.enum(["skip", "fill"]).optional(), version: z.number().int().min(1) }).strict();
export type ImportPatch = z.input<typeof importPatch>;
export const importCreate = z.object({
  entity: z.enum(importEntities), clientKey: z.uuid(), fileName: z.string().trim().min(1).max(200), csv: z.string().min(1),
}).strict();
export type ImportCreate = z.input<typeof importCreate>;

export const rowErrors = ["missing_name", "name_too_long", "invalid_email", "invalid_phone", "invalid_social", "invalid_domain", "notes_too_long", "description_too_long", "title_too_long",
  "duplicate_in_file", "matches_several_records", "identifier_taken", "changed_since_preview"] as const;
export type RowError = typeof rowErrors[number];
export const rowWarnings = ["possible_duplicate_name", "company_not_found", "company_ambiguous"] as const;
export type RowWarning = typeof rowWarnings[number];

export type PersonRow = { name: string; normalizedName: string; email: string; phone: string; social: string; notes: string; company: string; title: string };
export type CompanyRow = { name: string; normalizedName: string; domain: string | null; description: string };
export type ParsedRow<T> = { ok: true; value: T; keys: string[] } | { ok: false; error: RowError; keys: string[] };

const emailField = z.email().max(254);
/** Cell for a target, stripped of Harvest's own formula guard and surrounding whitespace. */
function cell(raw: string[], mapping: (string | null)[], target: ImportTarget) {
  const index = mapping.indexOf(target);
  return index < 0 ? "" : stripFormulaGuard(raw[index] ?? "").trim();
}

/** Validates and normalizes one person row. Identifier keys are "kind:normalized", as stored. */
export function parsePersonRow(raw: string[], mapping: (string | null)[]): ParsedRow<PersonRow> {
  const name = cell(raw, mapping, "name").replace(/\s+/g, " "), emailRaw = cell(raw, mapping, "email").toLowerCase();
  const phoneParse = phoneField.safeParse(cell(raw, mapping, "phone")), socialParse = socialField.safeParse(cell(raw, mapping, "social"));
  const keys: string[] = [];
  if (emailRaw && emailField.safeParse(emailRaw).success) keys.push(`email:${emailRaw}`);
  if (phoneParse.success && phoneParse.data) keys.push(`phone:${phoneParse.data}`);
  if (socialParse.success && socialParse.data) keys.push(`social:${socialParse.data.replace(/^@/, "").toLowerCase()}`);
  const notes = cell(raw, mapping, "notes"), company = cell(raw, mapping, "company"), title = cell(raw, mapping, "title");
  const fail = (error: RowError): ParsedRow<PersonRow> => ({ ok: false, error, keys });
  if (!name) return fail("missing_name");
  if (name.length > 100) return fail("name_too_long");
  if (emailRaw && !emailField.safeParse(emailRaw).success) return fail("invalid_email");
  if (!phoneParse.success) return fail("invalid_phone");
  if (!socialParse.success) return fail("invalid_social");
  if (notes.length > 5000) return fail("notes_too_long");
  if (title.length > 100) return fail("title_too_long");
  return { ok: true, keys, value: { name, normalizedName: normalizeName(name), email: emailRaw, phone: phoneParse.data, social: socialParse.data, notes, company, title } };
}

/** Validates and normalizes one company row. The normalized domain is the only identity key. */
export function parseCompanyRow(raw: string[], mapping: (string | null)[]): ParsedRow<CompanyRow> {
  const name = cell(raw, mapping, "name").replace(/\s+/g, " "), domainRaw = cell(raw, mapping, "domain"), description = cell(raw, mapping, "description");
  const domain = normalizeDomain(domainRaw);
  const keys = domain ? [`domain:${domain}`] : [];
  if (!name) return { ok: false, error: "missing_name", keys };
  if (name.length > 100) return { ok: false, error: "name_too_long", keys };
  if (domain === undefined) return { ok: false, error: "invalid_domain", keys };
  if (description.length > 2000) return { ok: false, error: "description_too_long", keys };
  return { ok: true, keys, value: { name, normalizedName: normalizeName(name), domain, description } };
}

/** "Company" cells that look like a domain match by domain; anything else by exact normalized name. */
export function companyReference(value: string): { domain: string } | { name: string } | null {
  if (!value) return null;
  const domain = /^[^\s]+\.[^\s]+$/.test(value) ? normalizeDomain(value) : undefined;
  return domain ? { domain } : { name: normalizeName(value) };
}
