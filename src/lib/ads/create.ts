import { addAdInput, adGoals, adPlacements, boostInput, createCampaignInput, specialAdCategories, type AdFormat, type AdGoal } from "./ads";

// The guided create flow's model: what the form holds, how it becomes a launch payload for the Ads routes, and which field each server rule points at. Pure: no fetch, no React.
/** Nine steps in three groups: Campaign (create, objective, budget), Ad set (ad set, audience, placements, schedule) and Ad (ad, publish). */
export const createSteps = ["create", "objective", "budget", "adset", "audience", "placements", "schedule", "ad", "publish"] as const;
export type CreateStep = typeof createSteps[number];
export const stepGroup: Record<CreateStep, "campaign" | "adset" | "ad"> = {
  create: "campaign", objective: "campaign", budget: "campaign", adset: "adset", audience: "adset", placements: "adset", schedule: "adset", ad: "ad", publish: "ad",
};
/** `campaign` is a new campaign with its first ad set and ad; `add_ad` adds an ad to an ad set that exists; `boost` turns a published post into an ad. */
export type Mode = "campaign" | "add_ad" | "boost";
const appliesTable: Record<Mode, readonly CreateStep[]> = {
  campaign: createSteps,
  boost: ["create", "objective", "budget", "audience", "placements", "schedule", "publish"],
  add_ad: ["create", "ad", "publish"],
};
/** The steps a flow uses; the others are listed disabled (an ad added to an ad set has no objective or budget of its own, a boost has no ad step). */
export const stepsFor = (mode: Mode): readonly CreateStep[] => appliesTable[mode];
export const ctas = ["learn_more", "sign_up", "contact_us", "get_directions", "watch_more", "send_message", "call_now", "donate"] as const;
export const commonCountries = ["US", "CA", "GB", "AU", "NZ", "ZA", "NG", "KE", "GH", "PH", "IN", "MX", "BR", "DE", "FR", "ES", "IT"] as const;
export const formatsOffered = ["image", "video", "carousel", "text", "messaging", "call"] as const;
/** The objectives the server supports, in the order shown; a boost has no messages goal. */
export const objectiveOrder = ["awareness", "traffic", "engagement", "video_views", "lead_generation", "messages", "conversions", "app_promotion"] as const satisfies readonly AdGoal[];
export const goalsFor = (mode: Mode): readonly AdGoal[] => objectiveOrder.filter((goal) => (mode === "boost" ? goal !== "messages" : true) && (adGoals as readonly string[]).includes(goal));
/** Buying types the server accepts. Only auction exists; the picker shows it and offers nothing else. */
export const buyingTypes = ["auction"] as const;
export const bidStrategies = ["lowest_cost", "cost_cap", "bid_cap"] as const;

export type Card = { mediaRef: string; mediaName: string; headline: string; linkUrl: string };
export type Draft = {
  mode: Mode; adAccountId: string; name: string; adSetName: string; goal: AdGoal | ""; buying: typeof buyingTypes[number];
  postRef: string; existingAdSetId: string;
  bidStrategy: typeof bidStrategies[number]; bidAmount: string;
  countries: string[]; ageMin: string; ageMax: string; gender: "all" | "male" | "female"; interests: { id: string; name: string }[]; includeAudiences: string[]; advantage: boolean;
  placementsMode: "automatic" | "manual"; placements: string[];
  budgetType: "daily" | "lifetime"; budgetAmount: string; startDate: string; endDate: string; categories: string[];
  format: AdFormat; mediaRefs: { ref: string; name: string }[]; cards: Card[]; headline: string; body: string; linkUrl: string; cta: string; leadFormId: string; messagingDestination: string; phoneNumber: string;
  status: "paused" | "active";
};
export const emptyDraft = (mode: Mode = "campaign", adAccountId = ""): Draft => ({
  mode, adAccountId, name: "", adSetName: "", goal: "", buying: "auction", postRef: "", existingAdSetId: "", bidStrategy: "lowest_cost", bidAmount: "",
  countries: ["US"], ageMin: "18", ageMax: "65", gender: "all", interests: [], includeAudiences: [], advantage: false,
  placementsMode: "automatic", placements: [], budgetType: "daily", budgetAmount: "", startDate: "", endDate: "", categories: [],
  format: "image", mediaRefs: [], cards: [], headline: "", body: "", linkUrl: "", cta: "learn_more", leadFormId: "", messagingDestination: "", phoneNumber: "", status: "paused",
});

const num = (value: string) => value.trim() === "" ? undefined : Number(value);
function creativeOf(d: Draft): Record<string, unknown> {
  const creative: Record<string, unknown> = { format: d.format, ...(d.headline.trim() ? { headline: d.headline.trim() } : {}), ...(d.body.trim() ? { body: d.body.trim() } : {}), ...(d.linkUrl.trim() ? { linkUrl: d.linkUrl.trim() } : {}),
    ...(d.cta ? { callToAction: d.cta } : {}) };
  if (d.format === "image" || d.format === "video") creative.mediaRefs = d.mediaRefs.map((m) => m.ref);
  if (d.format === "carousel") creative.cards = d.cards.map((c) => ({ mediaRef: c.mediaRef, ...(c.headline.trim() ? { headline: c.headline.trim() } : {}), ...(c.linkUrl.trim() ? { linkUrl: c.linkUrl.trim() } : {}) }));
  if (d.format === "messaging") creative.messagingDestination = d.messagingDestination;
  if (d.format === "call") creative.phoneNumber = d.phoneNumber.trim();
  if (d.goal === "lead_generation" && d.leadFormId) creative.leadFormId = d.leadFormId;
  return creative;
}
/** The launch payload for the Ads routes; empty fields are left out so the server's own rules decide what is missing. */
export function toPayload(d: Draft): Record<string, unknown> {
  if (d.mode === "add_ad") return { adAccountId: d.adAccountId, adSetId: d.existingAdSetId, name: d.name.trim(), creative: creativeOf(d), status: d.status };
  const targeting = {
    ...(d.countries.length ? { countries: d.countries } : {}), ...(num(d.ageMin) !== undefined ? { ageMin: num(d.ageMin) } : {}), ...(num(d.ageMax) !== undefined ? { ageMax: num(d.ageMax) } : {}),
    ...(d.gender !== "all" ? { genders: [d.gender] } : {}), ...(d.interests.length ? { interests: d.interests } : {}), ...(d.includeAudiences.length ? { includeAudiences: d.includeAudiences } : {}),
    ...(d.advantage ? { advantageAudience: true } : {}),
  };
  const common = {
    adAccountId: d.adAccountId, name: d.name.trim(), goal: d.goal, budgetAmount: num(d.budgetAmount), budgetType: d.budgetType, ...(d.startDate ? { startDate: d.startDate } : {}), ...(d.endDate ? { endDate: d.endDate } : {}),
    targeting, ...(d.placementsMode === "manual" ? { placements: d.placements } : {}), specialAdCategories: d.categories.filter((c) => c !== "none"), status: d.status,
  };
  if (d.mode === "boost") return { ...common, postRef: d.postRef, ...(d.existingAdSetId ? { existingAdSetId: d.existingAdSetId } : {}) };
  return { ...common, ...(d.adSetName.trim() ? { adSetName: d.adSetName.trim() } : {}),
    ...(d.bidStrategy !== "lowest_cost" ? { bidding: { costType: d.bidStrategy, ...(num(d.bidAmount) !== undefined ? { unitCost: num(d.bidAmount) } : {}) } } : {}), creative: creativeOf(d) };
}

export type Problem = { field: string; step: CreateStep };
function stepOfField(field: string, mode: Mode): CreateStep {
  const head = field.split(".")[0];
  if (["adAccountId", "adSetId", "existingAdSetId", "postRef"].includes(head)) return "create";
  if (head === "name") return mode === "add_ad" ? "ad" : "create";
  if (head === "goal") return "objective";
  if (["budgetAmount", "budgetType", "specialAdCategories", "attributionModel"].includes(head)) return "budget";
  if (["adSetName", "bidding"].includes(head)) return "adset";
  if (head === "targeting") return "audience";
  if (head === "placements") return "placements";
  if (["startDate", "endDate"].includes(head)) return "schedule";
  if (head === "creative") return "ad";
  if (head === "status") return "publish";
  return "create";
}
/** Which fields the server's rules refuse, by the first segment of each issue path, with the step each belongs to. */
export function problems(d: Draft): Problem[] {
  const schema = d.mode === "boost" ? boostInput : d.mode === "add_ad" ? addAdInput : createCampaignInput;
  const result = schema.safeParse(toPayload(d));
  const found = new Map<string, Problem>();
  if (!result.success) for (const issue of result.error.issues) {
    const path = issue.path.length === 0 ? "_" : issue.path[0] === "creative" ? `creative.${String(issue.path[1] ?? "")}`.replace(/\.$/, "") : String(issue.path[0]);
    let field = path === "targeting" ? `targeting.${String(issue.path[1] ?? "")}`.replace(/\.$/, "") : path;
    if (issue.code === "custom" && issue.message === "lifetime budget needs an end date") field = "endDate";
    if (issue.code === "custom" && issue.message === "end before start") field = "endDate";
    if (issue.code === "custom" && issue.message === "lead generation needs a lead form") field = "creative.leadFormId";
    if (issue.code === "custom" && issue.message === "messages goal needs a messaging ad") field = "creative.format";
    if (issue.code === "custom" && field === "creative") field = ({ media: "creative.mediaRefs", "messaging destination": "creative.messagingDestination", "phone number": "creative.phoneNumber" } as Record<string, string>)[issue.message]
      ?? (issue.message.startsWith("carousel") ? "creative.cards" : "creative.format");
    if (field === "adSetId") field = "existingAdSetId";
    found.set(field, { field, step: stepOfField(field, d.mode) });
  }
  if (d.mode !== "add_ad" && d.goal === "") found.set("goal", { field: "goal", step: "objective" });
  if (d.mode === "boost" && !d.postRef) found.set("postRef", { field: "postRef", step: "create" });
  if (d.mode !== "add_ad" && d.categories.includes("social_issues_elections_politics")) found.set("specialAdCategories", { field: "specialAdCategories", step: "budget" });
  return [...found.values()];
}
export const stepsWithProblems = (d: Draft) => new Set(problems(d).map((p) => p.step));

/** Resume from a saved launch payload (a draft request). Anything not in the payload keeps the default. */
export function fromPayload(kind: string, payload: Record<string, unknown>): Draft {
  const p = payload as Record<string, never> & { targeting?: Record<string, unknown>; creative?: Record<string, unknown> };
  const t = (p.targeting ?? {}) as { countries?: string[]; ageMin?: number; ageMax?: number; genders?: string[]; interests?: { id: string; name?: string }[]; includeAudiences?: string[]; advantageAudience?: boolean };
  const c = (p.creative ?? {}) as { format?: AdFormat; mediaRefs?: string[]; cards?: { mediaRef: string; headline?: string; linkUrl?: string }[]; headline?: string; body?: string; linkUrl?: string; callToAction?: string; leadFormId?: string; messagingDestination?: string; phoneNumber?: string };
  const base = emptyDraft(kind === "boost" ? "boost" : kind === "add_ad" ? "add_ad" : "campaign", String(payload.adAccountId ?? ""));
  const placements = (payload.placements as string[] | undefined) ?? [];
  const bid = payload.bidding as { costType?: string; unitCost?: number } | undefined;
  return { ...base, name: String(payload.name ?? ""), adSetName: String(payload.adSetName ?? ""), goal: (payload.goal as AdGoal) ?? "", postRef: String(payload.postRef ?? ""),
    existingAdSetId: String(payload.existingAdSetId ?? payload.adSetId ?? ""),
    bidStrategy: (bidStrategies as readonly string[]).includes(bid?.costType ?? "") ? bid!.costType as Draft["bidStrategy"] : "lowest_cost", bidAmount: bid?.unitCost === undefined ? "" : String(bid.unitCost),
    countries: t.countries ?? [], ageMin: t.ageMin === undefined ? "" : String(t.ageMin), ageMax: t.ageMax === undefined ? "" : String(t.ageMax), gender: (t.genders?.[0] as Draft["gender"]) ?? "all",
    interests: (t.interests ?? []).map((i) => ({ id: i.id, name: i.name ?? i.id })), includeAudiences: t.includeAudiences ?? [], advantage: t.advantageAudience === true,
    placementsMode: placements.length ? "manual" : "automatic", placements, budgetType: (payload.budgetType as Draft["budgetType"]) ?? "daily", budgetAmount: payload.budgetAmount === undefined ? "" : String(payload.budgetAmount),
    startDate: String(payload.startDate ?? ""), endDate: String(payload.endDate ?? ""), categories: (payload.specialAdCategories as string[] | undefined) ?? [],
    format: c.format ?? "image", mediaRefs: (c.mediaRefs ?? []).map((ref) => ({ ref, name: ref })), cards: (c.cards ?? []).map((x) => ({ mediaRef: x.mediaRef, mediaName: x.mediaRef, headline: x.headline ?? "", linkUrl: x.linkUrl ?? "" })),
    headline: c.headline ?? "", body: c.body ?? "", linkUrl: c.linkUrl ?? "", cta: c.callToAction ?? "", leadFormId: c.leadFormId ?? "", messagingDestination: c.messagingDestination ?? "", phoneNumber: c.phoneNumber ?? "",
    status: payload.status === "active" ? "active" : "paused" };
}
export const placementOptions = adPlacements;
export const categoryOptions = specialAdCategories.filter((c) => c !== "none");
