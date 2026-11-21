import { z } from "zod";

// CRM forms builder: the definition a ministry builds, plus the pure rules the builder, the preview and (later) the hosted form share.
// Stored as the `definition` of a draft `form_versions` row (kind `crm-form-v1`); nothing here is sent anywhere.

export const FORM_KIND = "crm-form-v1" as const;
export const blockTypes = ["short", "long", "date", "dropdown", "choice", "checkbox", "rating", "vote", "multi", "email", "website", "phone", "location", "upload", "number", "money", "signature", "info", "consent"] as const;
export type BlockType = (typeof blockTypes)[number];
export const crmFields = ["name", "email", "phone", "organization", "social", "notes"] as const;
export type CrmField = (typeof crmFields)[number];
export const layouts = ["one", "two", "paged"] as const;
export type FormLayout = (typeof layouts)[number];
export const formLimits = { blocks: 40, label: 200, text: 2000, options: 20, option: 100, title: 200, description: 1000, labels: 10, labelLength: 40, url: 500, button: 40 } as const;
/** Fixed id of the mandatory consent block. */
export const CONSENT_ID = "consent0";

export const choiceTypes: readonly BlockType[] = ["dropdown", "choice", "multi"];
/** The CRM field a block type may be saved to. */
export const mappableTypes: Record<CrmField, BlockType> = { name: "short", email: "email", phone: "phone", organization: "short", social: "short", notes: "long" };

export type FormBlock = { id: string; type: BlockType; label: string; required: boolean; options?: string[]; mapTo?: CrmField | null; text?: string };
export type FormDestination = { type: "people" | "organizations" | "pipeline"; pipelineId?: string };
export const coverIds = ["none", "dawn", "sea", "field", "dusk", "stone"] as const;
export const backgroundIds = ["plain", "muted", "accent", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export const buttonColorIds = ["primary", "foreground", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "destructive"] as const;
export type FormSettings = {
  ownerId: string | null; labels: string[]; redirectUrl: string; buttonLabel: string; startLabel: string; showResubmit: boolean; spamCheck: boolean;
  layout: FormLayout; theme: "light" | "dark"; background: (typeof backgroundIds)[number]; buttonColor: (typeof buttonColorIds)[number];
  landing: "preview" | "build"; hiddenCampaign: boolean; hiddenSource: boolean;
};
export type FormDefinition = {
  kind: typeof FORM_KIND; revision: number; updatedAt: string; title: string; description: string; cover: (typeof coverIds)[number]; logoUrl: string;
  destination: FormDestination | null; endTitle: string; endBody: string; blocks: FormBlock[]; settings: FormSettings;
};

const httpsUrl = z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(formLimits.url)]);
const blockSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{8}$/), type: z.enum(blockTypes), label: z.string().trim().min(1).max(formLimits.label), required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(formLimits.option)).min(2).max(formLimits.options).optional(),
  mapTo: z.enum(crmFields).nullable().optional(), text: z.string().max(formLimits.text).optional(),
}).strict();
export const formDefinitionSchema = z.object({
  kind: z.literal(FORM_KIND), revision: z.number().int().min(1), updatedAt: z.string(),
  title: z.string().trim().min(1).max(formLimits.title), description: z.string().max(formLimits.description),
  cover: z.enum(coverIds), logoUrl: httpsUrl,
  destination: z.object({ type: z.enum(["people", "organizations", "pipeline"]), pipelineId: z.uuid().optional() }).strict().nullable(),
  endTitle: z.string().trim().min(1).max(formLimits.title), endBody: z.string().max(formLimits.description),
  blocks: z.array(blockSchema).max(formLimits.blocks),
  settings: z.object({
    ownerId: z.string().max(100).nullable(), labels: z.array(z.string().trim().min(1).max(formLimits.labelLength)).max(formLimits.labels),
    redirectUrl: httpsUrl, buttonLabel: z.string().trim().min(1).max(formLimits.button), startLabel: z.string().trim().min(1).max(formLimits.button),
    showResubmit: z.boolean(), spamCheck: z.boolean(), layout: z.enum(layouts), theme: z.enum(["light", "dark"]),
    background: z.enum(backgroundIds), buttonColor: z.enum(buttonColorIds), landing: z.enum(["preview", "build"]), hiddenCampaign: z.boolean(), hiddenSource: z.boolean(),
  }).strict(),
}).strict().superRefine((form, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (new Set(form.blocks.map((b) => b.id)).size !== form.blocks.length) issue(["blocks"], "duplicate ids");
  const consent = form.blocks.filter((b) => b.type === "consent");
  if (consent.length !== 1 || form.blocks[form.blocks.length - 1]?.type !== "consent" || !consent[0].required) issue(["blocks"], "consent");
  const mapped = new Set<string>();
  form.blocks.forEach((b, i) => {
    if (choiceTypes.includes(b.type) !== Boolean(b.options)) issue(["blocks", i, "options"], "options");
    if (b.options && new Set(b.options).size !== b.options.length) issue(["blocks", i, "options"], "duplicate");
    if (b.mapTo) {
      if (mappableTypes[b.mapTo] !== b.type) issue(["blocks", i, "mapTo"], "type");
      if (mapped.has(b.mapTo)) issue(["blocks", i, "mapTo"], "duplicate"); mapped.add(b.mapTo);
    }
    if (b.type === "info" && b.required) issue(["blocks", i, "required"], "info");
  });
  if (form.destination?.type === "pipeline" && !form.destination.pipelineId) issue(["destination"], "pipeline");
});

export const newBlockId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** The add-question menu: groups in menu order; each item is a new question or one saved to a CRM field. Labels live in `CrmForms.menu`. */
export type MenuItem = { id: string; type: BlockType; mapTo?: CrmField };
export type MenuGroup = { id: string; items: MenuItem[] };
export const menuGroups: readonly MenuGroup[] = [
  { id: "crm", items: crmFields.map((field) => ({ id: `map-${field}`, type: mappableTypes[field], mapTo: field })) },
  { id: "short", items: [{ id: "short", type: "short" }, { id: "map-name", type: "short", mapTo: "name" }, { id: "map-organization", type: "short", mapTo: "organization" }, { id: "map-social", type: "short", mapTo: "social" }] },
  { id: "long", items: [{ id: "long", type: "long" }, { id: "map-notes", type: "long", mapTo: "notes" }] },
  { id: "dates", items: [{ id: "date", type: "date" }] },
  { id: "single", items: [{ id: "dropdown", type: "dropdown" }, { id: "choice", type: "choice" }, { id: "checkbox", type: "checkbox" }, { id: "rating", type: "rating" }, { id: "vote", type: "vote" }] },
  { id: "multi", items: [{ id: "multi", type: "multi" }] },
  { id: "contact", items: [{ id: "email", type: "email" }, { id: "website", type: "website" }, { id: "phone", type: "phone" }, { id: "location", type: "location" }, { id: "map-email", type: "email", mapTo: "email" }, { id: "map-phone", type: "phone", mapTo: "phone" }] },
  { id: "uploads", items: [{ id: "upload", type: "upload" }] },
  { id: "number", items: [{ id: "number", type: "number" }, { id: "money", type: "money" }] },
  { id: "signature", items: [{ id: "signature", type: "signature" }] },
  { id: "layout", items: [{ id: "info", type: "info" }] },
];
export const menuLayoutGroup = "layout";

/** Options a new choice block starts with. */
export function defaultOptions(type: BlockType, labels: [string, string]): string[] | undefined {
  return choiceTypes.includes(type) ? [...labels] : undefined;
}

export function newBlock(item: MenuItem, label: string, optionLabels: [string, string]): FormBlock {
  const block: FormBlock = { id: newBlockId(), type: item.type, label, required: item.mapTo === "name" || item.mapTo === "email", mapTo: item.mapTo ?? null };
  const options = defaultOptions(item.type, optionLabels);
  if (options) block.options = options;
  if (item.type === "info") { block.required = false; block.text = ""; }
  return block;
}

/** Changing a block's type keeps its label; options appear or disappear, and a CRM mapping that no longer fits is cleared. */
export function normalizeBlock(block: FormBlock, optionLabels: [string, string]): FormBlock {
  const next: FormBlock = { ...block };
  if (choiceTypes.includes(next.type)) next.options = next.options && next.options.length >= 2 ? next.options : [...optionLabels]; else delete next.options;
  if (next.mapTo && mappableTypes[next.mapTo] !== next.type) next.mapTo = null;
  if (next.type !== "info" && next.type !== "consent") delete next.text;
  return next;
}

/** Moves one block; the consent block stays last and cannot be moved. */
export function moveBlock(blocks: FormBlock[], from: number, to: number): FormBlock[] {
  const movable = blocks.filter((b) => b.type !== "consent").length;
  if (from === to || from < 0 || to < 0 || from >= movable || to >= movable) return blocks;
  const next = [...blocks]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
}
export function insertBlock(blocks: FormBlock[], block: FormBlock): FormBlock[] {
  const at = blocks.findIndex((b) => b.type === "consent");
  return at < 0 ? [...blocks, block] : [...blocks.slice(0, at), block, ...blocks.slice(at)];
}
/** The consent block is mandatory: it cannot be removed. */
export const removeBlock = (blocks: FormBlock[], id: string) => blocks.filter((b) => b.id !== id || b.type === "consent");

export type FormIssue = "noName" | "noContact" | "noDestination" | "emptyChoice";
/** What stops a form from being ready: it needs a person to save (a Name question) and a way to reach them, and a destination. */
export function formIssues(form: FormDefinition): FormIssue[] {
  const issues: FormIssue[] = [];
  if (!form.destination) issues.push("noDestination");
  if (!form.blocks.some((b) => b.mapTo === "name")) issues.push("noName");
  if (!form.blocks.some((b) => b.mapTo === "email" || b.mapTo === "phone")) issues.push("noContact");
  if (form.blocks.some((b) => b.options?.some((o) => !o.trim()))) issues.push("emptyChoice");
  return issues;
}

export type FormAnswers = Record<string, string | string[]>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phonePattern = /^\+?[0-9()\s.-]{7,20}$/;
export type AnswerError = "required" | "email" | "website" | "phone" | "number" | "consent";
/** Checks one answer against its block. Info blocks have nothing to answer. */
export function validateBlock(block: FormBlock, value: string | string[] | undefined): AnswerError | null {
  if (block.type === "info") return null;
  const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim();
  if (block.type === "consent") return value === "yes" ? null : "consent";
  if (empty) return block.required ? "required" : null;
  const text = String(value).trim();
  if (block.type === "email" && !emailPattern.test(text)) return "email";
  if (block.type === "website" && !z.url({ protocol: /^https?$/ }).safeParse(text.includes("://") ? text : `https://${text}`).success) return "website";
  if (block.type === "phone" && !phonePattern.test(text)) return "phone";
  if ((block.type === "number" || block.type === "money") && !Number.isFinite(Number(text))) return "number";
  if (block.type === "checkbox" && block.required && text !== "yes") return "required";
  return null;
}
export function validateForm(form: FormDefinition, answers: FormAnswers): Record<string, AnswerError> {
  const errors: Record<string, AnswerError> = {};
  for (const block of form.blocks) { const error = validateBlock(block, answers[block.id]); if (error) errors[block.id] = error; }
  return errors;
}

/** Answer recall: `{name}` becomes what the person typed in the question saved to Name (or the first short-text question). */
export function recallName(form: FormDefinition, answers: FormAnswers): string {
  const block = form.blocks.find((b) => b.mapTo === "name") ?? form.blocks.find((b) => b.type === "short");
  const value = block ? answers[block.id] : "";
  return typeof value === "string" ? value.trim() : "";
}
export function recall(text: string, form: FormDefinition, answers: FormAnswers): string {
  const name = recallName(form, answers);
  return text.replace(/\{name\}/g, name).replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/,\s*$/, "").trim();
}

/** Questions in page order for one-per-page mode: every question, then the consent block last (it is the final step). Info blocks are shown with the next question. */
export function pagedSteps(blocks: FormBlock[]): FormBlock[][] {
  const steps: FormBlock[][] = []; let lead: FormBlock[] = [];
  for (const block of blocks) {
    if (block.type === "info") { lead.push(block); continue; }
    steps.push([...lead, block]); lead = [];
  }
  if (lead.length) steps.push(lead);
  return steps;
}

/** Undo history. A burst of edits with the same `key` inside `windowMs` is one step, so a typed sentence undoes in one go. */
export type History<T> = { past: T[]; present: T; future: T[]; lastKey: string | null; lastAt: number };
export const startHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 });
export function commit<T>(history: History<T>, next: T, now: number, key: string | null = null, windowMs = 1000, limit = 100): History<T> {
  if (Object.is(next, history.present)) return history;
  const merge = key !== null && key === history.lastKey && now - history.lastAt < windowMs;
  const past = merge ? history.past : [...history.past, history.present].slice(-limit);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}
export function undo<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future], lastKey: null, lastAt: 0 };
}
export function redo<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1), lastKey: null, lastAt: 0 };
}

/** Starter forms. Question labels and option lists come from the catalogue (`CrmForms.templates.<id>`). */
export type TemplateQuestion = { key: string; type: BlockType; mapTo?: CrmField; required?: boolean; options?: boolean };
export const templateIds = ["prayer", "event", "volunteer", "feedback", "visitor"] as const;
export type TemplateId = (typeof templateIds)[number];
export const templates: Record<TemplateId, TemplateQuestion[]> = {
  prayer: [{ key: "name", type: "short", mapTo: "name", required: true }, { key: "email", type: "email", mapTo: "email", required: true }, { key: "phone", type: "phone", mapTo: "phone" },
    { key: "request", type: "long", mapTo: "notes", required: true }, { key: "share", type: "choice", options: true }],
  event: [{ key: "name", type: "short", mapTo: "name", required: true }, { key: "email", type: "email", mapTo: "email", required: true }, { key: "phone", type: "phone", mapTo: "phone" },
    { key: "guests", type: "number" }, { key: "session", type: "dropdown", options: true }, { key: "needs", type: "long", mapTo: "notes" }],
  volunteer: [{ key: "name", type: "short", mapTo: "name", required: true }, { key: "email", type: "email", mapTo: "email", required: true }, { key: "phone", type: "phone", mapTo: "phone" },
    { key: "areas", type: "multi", options: true, required: true }, { key: "availability", type: "dropdown", options: true }, { key: "about", type: "long", mapTo: "notes" }],
  feedback: [{ key: "rating", type: "rating", required: true }, { key: "liked", type: "long" }, { key: "improve", type: "long" }, { key: "name", type: "short", mapTo: "name" }, { key: "email", type: "email", mapTo: "email" }],
  visitor: [{ key: "name", type: "short", mapTo: "name", required: true }, { key: "email", type: "email", mapTo: "email", required: true }, { key: "phone", type: "phone", mapTo: "phone" },
    { key: "organization", type: "short", mapTo: "organization" }, { key: "heard", type: "dropdown", options: true }, { key: "notes", type: "long", mapTo: "notes" }],
};
export const isTemplateId = (value: unknown): value is TemplateId => typeof value === "string" && (templateIds as readonly string[]).includes(value);

export const defaultSettings = (): FormSettings => ({
  ownerId: null, labels: [], redirectUrl: "", buttonLabel: "Submit", startLabel: "Start", showResubmit: false, spamCheck: true, layout: "one", theme: "light",
  background: "plain", buttonColor: "primary", landing: "build", hiddenCampaign: true, hiddenSource: true,
});

/** Translators the builder passes in: `t(key, values)` resolves `CrmForms.*` keys relative to the namespace. */
export type FormText = (key: string, values?: Record<string, string | number>) => string;
export function buildForm(template: TemplateId | null, destination: FormDestination | null, text: FormText, now: string): FormDefinition {
  const blocks: FormBlock[] = [];
  if (template) for (const q of templates[template]) {
    const block: FormBlock = { id: newBlockId(), type: q.type, label: text(`templates.${template}.q.${q.key}`), required: Boolean(q.required), mapTo: q.mapTo ?? null };
    if (q.options) block.options = text(`templates.${template}.q.${q.key}Options`).split("|").map((o) => o.trim()).filter(Boolean);
    blocks.push(block);
  }
  blocks.push({ id: CONSENT_ID, type: "consent", label: text("defaults.consentLabel"), required: true, mapTo: null, text: text("defaults.consentText") });
  return {
    kind: FORM_KIND, revision: 1, updatedAt: now, title: template ? text(`templates.${template}.name`) : text("defaults.title"),
    description: "", cover: "none", logoUrl: "", destination, endTitle: text("defaults.endTitle"), endBody: text("defaults.endBody"), blocks,
    settings: { ...defaultSettings(), buttonLabel: text("defaults.button"), startLabel: text("defaults.start") },
  };
}
