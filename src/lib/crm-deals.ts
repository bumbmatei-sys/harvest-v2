import { z } from "zod";

/**
 * CRM-04 shared model: pipelines, stages and opportunities (deals). Pure and
 * client-safe so the UI and the server validate with the same rules.
 */
export const stageKinds = ["open", "won", "lost"] as const;
export type StageKind = typeof stageKinds[number];
export const stageColors = ["neutral", "primary", "success", "warning", "destructive"] as const;
export type StageColor = typeof stageColors[number];
export const STAGE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_STAGES = 20;
/** Stale deals and "today" are evaluated in this zone (the app has no per-workspace time zone yet). */
export const CRM_TIME_ZONE = "Europe/Berlin";

export type Stage = { id: string; pipelineId: string; key: string; name: string; kind: StageKind; probability: number | null; color: StageColor; position: number; archivedAt: Date | string | null; version: number };
export type Pipeline = { id: string; name: string; isDefault: boolean; position: number; archivedAt: Date | string | null; version: number; stages: Stage[] };

/** Default stages, created once per workspace. Names are message keys under Crm.defaultStages. */
export const defaultStages: { key: string; kind: StageKind; probability: number; color: StageColor }[] = [
  { key: "new", kind: "open", probability: 10, color: "neutral" },
  { key: "contacted", kind: "open", probability: 25, color: "primary" },
  { key: "qualified", kind: "open", probability: 50, color: "primary" },
  { key: "proposal", kind: "open", probability: 75, color: "warning" },
  { key: "won", kind: "won", probability: 100, color: "success" },
  { key: "lost", kind: "lost", probability: 0, color: "destructive" },
];

const name60 = z.string().trim().min(1).max(60);
const version = z.number().int().min(1);
const probability = z.number().int().min(0).max(100).nullable();
export const pipelineInput = z.object({ name: name60 }).strict();
export const pipelinePatch = z.object({ name: name60.optional(), isDefault: z.literal(true).optional(), archived: z.boolean().optional(), version }).strict();
export const stageInput = z.object({
  name: name60, key: z.string().regex(STAGE_KEY).optional(), kind: z.enum(stageKinds).default("open"),
  probability: probability.default(null), color: z.enum(stageColors).default("neutral"),
}).strict();
export const stagePatch = z.object({ name: name60.optional(), probability: probability.optional(), color: z.enum(stageColors).optional(), archived: z.boolean().optional(), version }).strict();
export const stageOrder = z.object({ stageIds: z.array(z.uuid()).min(1).max(MAX_STAGES) }).strict();
export type PipelineInput = z.input<typeof pipelineInput>;
export type PipelinePatch = z.input<typeof pipelinePatch>;
export type StageInput = z.input<typeof stageInput>;
export type StagePatch = z.input<typeof stagePatch>;

/** A machine key from a stage name: "Follow up" → "follow_up". */
export function stageKey(name: string) {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `stage_${slug}`.slice(0, 40).replace(/_+$/, "");
}

// ---------------------------------------------------------------------------
// Deals.
/** Amounts are decimal strings with up to two places; stored as numeric(14,2). */
export const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const amount = z.union([z.string().trim().regex(AMOUNT), z.literal("")]).transform((value) => (value === "" ? null : value));
/** One currency per workspace for now (USD); the column is ready for more. */
const currency = z.literal("USD");
const day = z.union([z.iso.date(), z.literal("")]).transform((value) => (value === "" ? null : value));
const optionalId = z.union([z.uuid(), z.literal(""), z.null()]).transform((value) => (value ? value : null));
const reason = z.string().trim().max(500).transform((value) => (value === "" ? null : value));
export const DEFAULT_CURRENCY = "USD";
export const dealInput = z.object({
  name: z.string().trim().min(1).max(200), pipelineId: z.uuid().optional(), stageId: z.uuid().optional(),
  amount: amount.optional(), currency: currency.default(DEFAULT_CURRENCY), expectedCloseDate: day.optional(),
  ownerUserId: z.union([z.string().min(1).max(200), z.literal(""), z.null()]).transform((value) => value || null).optional(),
  companyId: optionalId.optional(), contactId: optionalId.optional(),
}).strict().refine((value) => !!value.companyId || !!value.contactId, { path: ["companyId"], message: "RELATION_REQUIRED" });
export const dealPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(), amount: amount.optional(), currency: currency.optional(), expectedCloseDate: day.optional(),
  ownerUserId: z.union([z.string().min(1).max(200), z.literal(""), z.null()]).transform((value) => value || null).optional(),
  companyId: optionalId.optional(), contactId: optionalId.optional(), closedReason: reason.optional(), archived: z.boolean().optional(), version,
}).strict();
export const dealMove = z.object({ stageId: z.uuid(), version, closedReason: reason.optional() }).strict();
export type DealInput = z.input<typeof dealInput>;
export type DealPatch = z.input<typeof dealPatch>;
export type DealMove = z.input<typeof dealMove>;

/** Weighted value of one deal: amount × probability, open stages only; a missing amount or probability contributes nothing. */
export function weightedValue(amountValue: string | number | null, kind: StageKind, stageProbability: number | null) {
  if (kind !== "open" || amountValue === null || stageProbability === null) return 0;
  return Math.round(Number(amountValue) * stageProbability) / 100;
}
/** Today's calendar date (YYYY-MM-DD) in the CRM time zone. */
export function crmToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CRM_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** A deal is stale when it is still open and its expected close date has passed. */
export function isStale(kind: StageKind, expectedCloseDate: string | null, today: string) {
  return kind === "open" && expectedCloseDate !== null && expectedCloseDate < today;
}

// ---------------------------------------------------------------------------
// Board and list state (URL-backed).
export const dealSorts = ["name", "amount", "close", "created", "updated"] as const;
/** Same page size as the People and Companies lists (RecordPagination). */
export const DEAL_PAGE_SIZE = 20;
/** The board renders at most this many deals; the list paginates everything. */
export const BOARD_LIMIT = 500;
const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
export const dealQuery = z.object({
  mode: z.enum(["board", "list"]).default("board"),
  q: z.string().trim().max(100).default(""),
  stage: z.union([z.uuid(), z.literal("")]).default(""),
  owner: z.string().max(200).default(""),
  stale: z.enum(["", "1"]).default(""),
  min: z.union([z.string().regex(AMOUNT), z.literal("")]).default(""),
  max: z.union([z.string().regex(AMOUNT), z.literal("")]).default(""),
  sort: z.string().regex(new RegExp(`^-?(${dealSorts.join("|")})$`)).default("-updated"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export type DealQuery = z.output<typeof dealQuery>;
export const dealQueryKeys = ["mode", "q", "stage", "owner", "stale", "min", "max", "sort", "page"] as const;
export function parseDealQuery(raw: Record<string, unknown>) {
  const picked = Object.fromEntries(dealQueryKeys.flatMap((key) => (raw[key] === undefined ? [] : [[key, one(raw[key])]])));
  return dealQuery.safeParse(picked);
}
export function dealQueryParams(query: DealQuery) {
  const params = new URLSearchParams();
  const defaults = dealQuery.parse({});
  for (const key of dealQueryKeys) if (query[key] !== defaults[key]) params.set(key, String(query[key]));
  return params;
}
