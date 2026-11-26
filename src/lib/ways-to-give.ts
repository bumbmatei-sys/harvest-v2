import { z } from "zod";
import { safeHttpsUrl } from "./link-in-bio";

// Ways to give (CW-10, founder decision 26 Nov): until a donation provider is chosen, people give through the ministry's OWN accounts and an admin records totals
// by hand. Each method is a label the ministry chose for one of its own accounts. Harvest never calls these services, fetches, previews or follows the links,
// and processes no payment. Everything here is pure: kinds, limits, validation and the projection the public block shows.

/**
 * Approved giving platforms (founder decision 26 Nov): each is validated to its exact web hosts. There is no free "any link" kind.
 * TEMPORARY: GoFundMe and Donorbox are allowed only until Harvest adds a payment provider (Stripe or another); remove them from this list, the database check
 * in the ways-to-give migration and the messages when that provider ships (docs/decisions/founder-decisions-2026-11.md, docs/acceptance/cw-giving.md).
 */
export const givingPlatformHosts = {
  gofundme: ["gofundme.com", "www.gofundme.com", "gofund.me"], // TEMPORARY until a payment provider is added.
  donorbox: ["donorbox.org", "www.donorbox.org"], // TEMPORARY until a payment provider is added.
  givebutter: ["givebutter.com", "www.givebutter.com"],
  tithely: ["tithe.ly", "www.tithe.ly", "give.tithe.ly"],
  pushpay: ["pushpay.com", "www.pushpay.com"],
  planning_center: [], // Planning Center Giving: one ministry subdomain of churchcenter.com (see givingHostSuffix).
  subsplash: ["subsplash.com", "www.subsplash.com"],
  givelify: ["givelify.com", "www.givelify.com", "giving.givelify.com"],
  zeffy: ["zeffy.com", "www.zeffy.com"],
  every_org: ["every.org", "www.every.org"],
  justgiving: ["justgiving.com", "www.justgiving.com"],
  patreon: ["patreon.com", "www.patreon.com"],
  ko_fi: ["ko-fi.com", "www.ko-fi.com"],
  buy_me_a_coffee: ["buymeacoffee.com", "www.buymeacoffee.com"],
} as const satisfies Record<string, readonly string[]>;
export type GivingPlatform = keyof typeof givingPlatformHosts;
export const givingPlatforms = Object.keys(givingPlatformHosts) as GivingPlatform[];
/** Kinds whose host is one ministry subdomain of a fixed domain (one DNS label, no deeper nesting). */
const givingHostSuffix: Partial<Record<GivingKind, string>> = { planning_center: ".churchcenter.com" };

/** Kinds the ministry can pick. The names are the ministry's own account types (founder request); no logo or integration comes with them. */
export const givingKinds = ["paypal", "wise", "venmo", "zelle", "revolut", "cash_app", "bank_transfer", ...givingPlatforms] as const;
export type GivingKind = "paypal" | "wise" | "venmo" | "zelle" | "revolut" | "cash_app" | "bank_transfer" | GivingPlatform;
export const givingLimits = { methods: 20, label: 60, url: 2048, handle: 64, holder: 100, note: 140, reportNote: 500 } as const;

type KindRule = { url: "required" | "optional" | "none"; handle: "required" | "optional" | "none"; hosts?: readonly string[]; bank?: true };
/**
 * Exact host allow-lists for every link (no wildcard, no lookalike). Venmo, Revolut and Cash App take a link or a handle (exactly one); Zelle takes a handle
 * (email or phone) only; a bank transfer takes account details only; every giving platform takes a link on its own hosts.
 */
export const givingKindRules: Record<GivingKind, KindRule> = {
  paypal: { url: "required", handle: "none", hosts: ["paypal.me", "www.paypal.me", "paypal.com", "www.paypal.com"] },
  wise: { url: "required", handle: "none", hosts: ["wise.com", "www.wise.com"] },
  venmo: { url: "optional", handle: "optional", hosts: ["venmo.com", "www.venmo.com", "account.venmo.com"] },
  zelle: { url: "none", handle: "required" },
  revolut: { url: "optional", handle: "optional", hosts: ["revolut.me"] },
  cash_app: { url: "optional", handle: "optional", hosts: ["cash.app"] },
  bank_transfer: { url: "none", handle: "none", bank: true },
  ...Object.fromEntries(givingPlatforms.map((platform) => [platform, { url: "required", handle: "none", hosts: givingPlatformHosts[platform] }])) as unknown as Record<GivingPlatform, KindRule>,
};

// ---- Links -----------------------------------------------------------------------------------------------------------------------------------------------
const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/**
 * A giving link: the link-in-bio https rules (no credentials, no control characters, a dotted host) plus no IP literal, no explicit port, and one of the kind's
 * exact hosts (or, for a subdomain kind, one label under its domain). Returns the normalised address or null. Nothing is fetched.
 */
export function givingUrl(kind: GivingKind, value: string): string | null {
  const safe = safeHttpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.port || ipv4.test(url.hostname) || url.hostname.startsWith("[")) return null;
  const rule = givingKindRules[kind], suffix = givingHostSuffix[kind];
  if (rule.url === "none") return null;
  const label = suffix && url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : null;
  const subdomainOk = label !== null && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && label !== "www";
  if (!(rule.hosts ?? []).includes(url.hostname) && !subdomainOk) return null;
  return url.href;
}

// ---- Handles ---------------------------------------------------------------------------------------------------------------------------------------------
const email = z.email().max(254);
/** Normalised handle for the kind, or null: Venmo `@name`, Revolut `@name`, Cash App `$name`, Zelle an email address or a phone number. */
export function givingHandle(kind: GivingKind, value: string): string | null {
  const text = value.trim();
  if (!text || text.length > givingLimits.handle) return null;
  switch (kind) {
    case "venmo": { const m = /^@?([A-Za-z0-9_-]{5,30})$/.exec(text); return m ? `@${m[1]}` : null; }
    case "revolut": { const m = /^@?([A-Za-z0-9]{3,30})$/.exec(text); return m ? `@${m[1].toLowerCase()}` : null; }
    case "cash_app": { const m = /^\$?([A-Za-z][A-Za-z0-9]{0,19})$/.exec(text); return m ? `$${m[1]}` : null; }
    case "zelle": {
      if (email.safeParse(text).success) return text.toLowerCase();
      const digits = text.replace(/[\s().-]/g, "");
      return /^\+?\d{10,15}$/.test(digits) ? text.replace(/\s+/g, " ") : null;
    }
    default: return null;
  }
}

// ---- Bank details ----------------------------------------------------------------------------------------------------------------------------------------
/** IBAN without spaces, upper case. */
export const compactIban = (value: string) => value.replace(/\s+/g, "").toUpperCase();
/** True for a well-formed IBAN whose ISO 13616 mod-97 check digits are right (the database repeats this check). */
export function validIban(value: string): boolean {
  const iban = compactIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const char of moved) {
    const code = char.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : char;
    for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}
/** Groups of four for display and copying by eye; copy buttons copy the compact form. */
export const formatIban = (value: string) => compactIban(value).replace(/(.{4})(?=.)/g, "$1 ");
/** ISO 9362 BIC: 8 or 11 characters, upper case. */
export function validBic(value: string): boolean { return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.replace(/\s+/g, "").toUpperCase()); }

// ---- Input -----------------------------------------------------------------------------------------------------------------------------------------------
const plain = (max: number) => z.string().max(max).refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value)).transform((value) => value.trim());
const optionalText = (max: number) => plain(max).nullable().optional().transform((value) => value ? value : null);

/** One method as the owner submits it. `superRefine` applies the per-kind rules and normalises link, handle and bank details. */
export const givingMethodInputSchema = z.object({
  kind: z.enum(givingKinds as unknown as [GivingKind, ...GivingKind[]]),
  label: plain(givingLimits.label).pipe(z.string().min(1)),
  url: optionalText(givingLimits.url),
  handle: optionalText(givingLimits.handle),
  iban: optionalText(50),
  bic: optionalText(20),
  accountHolder: optionalText(givingLimits.holder),
  note: optionalText(givingLimits.note),
  enabled: z.boolean(),
}).strict().transform((input, ctx) => {
  const rule = givingKindRules[input.kind];
  const issue = (path: string, message: string) => { ctx.addIssue({ code: "custom", path: [path], message }); };
  let url: string | null = null, handle: string | null = null;
  if (rule.url === "none" && input.url) issue("url", "not_allowed");
  if (rule.handle === "none" && input.handle) issue("handle", "not_allowed");
  if (rule.url !== "none" && input.url) { url = givingUrl(input.kind, input.url); if (!url) issue("url", "url"); }
  if (rule.handle !== "none" && input.handle) { handle = givingHandle(input.kind, input.handle); if (!handle) issue("handle", "handle"); }
  if (rule.url === "required" && !input.url) issue("url", "required");
  if (rule.handle === "required" && !input.handle) issue("handle", "required");
  if (rule.url === "optional" && rule.handle === "optional") {
    if (!input.url && !input.handle) issue("handle", "required");
    if (input.url && input.handle) issue("handle", "one_of");
  }
  let iban: string | null = null, bic: string | null = null, accountHolder: string | null = null;
  if (rule.bank) {
    if (!input.iban) issue("iban", "required"); else if (!validIban(input.iban)) issue("iban", "iban"); else iban = compactIban(input.iban);
    if (input.bic) { if (!validBic(input.bic)) issue("bic", "bic"); else bic = input.bic.replace(/\s+/g, "").toUpperCase(); }
    if (!input.accountHolder) issue("accountHolder", "required"); else accountHolder = input.accountHolder;
  } else {
    if (input.iban) issue("iban", "not_allowed");
    if (input.bic) issue("bic", "not_allowed");
    if (input.accountHolder) issue("accountHolder", "not_allowed");
  }
  return { kind: input.kind, label: input.label, url, handle, iban, bic, accountHolder, note: input.note, enabled: input.enabled };
});
export type GivingMethodInput = z.input<typeof givingMethodInputSchema>;
export type GivingMethodValues = z.output<typeof givingMethodInputSchema>;
export type GivingFieldIssue = "required" | "invalid" | "url" | "handle" | "iban" | "bic" | "one_of" | "not_allowed";
const namedIssues = new Set<string>(["required", "url", "handle", "iban", "bic", "one_of", "not_allowed"]);
/** Per-field problems for the form (first issue per field). Empty when the input is valid. */
export function givingFieldIssues(input: GivingMethodInput): Partial<Record<"label" | "url" | "handle" | "iban" | "bic" | "accountHolder", GivingFieldIssue>> {
  const parsed = givingMethodInputSchema.safeParse(input);
  if (parsed.success) return {};
  const out: Partial<Record<string, GivingFieldIssue>> = {};
  for (const item of parsed.error.issues) {
    const key = String(item.path[0] ?? "label");
    out[key] ??= item.code === "custom" ? (namedIssues.has(item.message) ? item.message as GivingFieldIssue : "invalid") : item.code === "too_small" ? "required" : "invalid";
  }
  return out;
}

// ---- What a visitor sees ---------------------------------------------------------------------------------------------------------------------------------
/** An enabled method as the public block shows it (no ids of people, no order numbers, no audit data). */
export type GivingPublicMethod = { id: string; kind: GivingKind; label: string; url: string | null; handle: string | null; iban: string | null; bic: string | null; accountHolder: string | null; note: string | null };
const publicMethodSchema = z.object({ id: z.uuid(), kind: z.enum(givingKinds as unknown as [GivingKind, ...GivingKind[]]), label: z.string(), url: z.string().nullable(), handle: z.string().nullable(), iban: z.string().nullable(),
  bic: z.string().nullable(), accountHolder: z.string().nullable(), note: z.string().nullable() });
/** Parses what the database returns and drops anything that no longer validates (a link is re-checked on every read). */
export function publicGivingMethods(raw: unknown): GivingPublicMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = publicMethodSchema.safeParse(item);
    if (!parsed.success) return [];
    const method = parsed.data;
    if (method.url && !givingUrl(method.kind, method.url)) return [];
    if (method.iban && !validIban(method.iban)) return [];
    return [method];
  });
}

// ---- Reports (a visitor flags a page; Harvest staff review) ----------------------------------------------------------------------------------------------
export const givingReportReasons = ["impersonation", "scam", "wrong_details", "inappropriate", "other"] as const;
export type GivingReportReason = typeof givingReportReasons[number];
/** What the visitor sends. Each public page has its own report route that resolves the ministry (link in bio: POST /l/:handle/report). */
export const givingReportSchema = z.object({
  reason: z.enum(givingReportReasons),
  note: z.string().max(givingLimits.reportNote).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).transform((value) => value.trim() || null).optional(),
  website: z.string().max(200).optional(), // Honeypot.
}).strict();
export type GivingReportInput = z.input<typeof givingReportSchema>;
