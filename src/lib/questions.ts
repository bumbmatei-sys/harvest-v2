import { z } from "zod";

// Shared Harvest question sets (Communities PR 4a): owners build them, members answer them. Stored as data and
// rendered at runtime; reused later by events, courses and campaigns. The SQL helper community_answers_valid
// (migration 0037) enforces the same rules as a backstop.
export const questionTypes = ["short", "paragraph", "choice", "checkboxes"] as const;
export type QuestionType = (typeof questionTypes)[number];
export type Question = { id: string; type: QuestionType; label: string; required: boolean; options?: string[] };
export type Answers = Record<string, string | string[]>;
export const questionLimits = { questions: 10, label: 200, options: 20, option: 100, short: 200, paragraph: 2000 } as const;

const label = z.string().trim().min(1).max(questionLimits.label);
const option = z.string().trim().min(1).max(questionLimits.option);
const question = z.object({
  id: z.string().regex(/^[a-z0-9]{8}$/), type: z.enum(questionTypes), label, required: z.boolean(),
  options: z.array(option).min(2).max(questionLimits.options).optional(),
}).strict().superRefine((q, ctx) => {
  const choice = q.type === "choice" || q.type === "checkboxes";
  if (choice !== Boolean(q.options)) ctx.addIssue({ code: "custom", path: ["options"], message: "options" });
  if (q.options && new Set(q.options).size !== q.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "duplicate" });
});
export const questionSet = z.array(question).max(questionLimits.questions)
  .refine((set) => new Set(set.map((q) => q.id)).size === set.length, "duplicate ids");

// Web Crypto, so the owner-side builder can create ids in the browser too.
export const newQuestionId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** Checks answers against the questions they were given for. Unknown ids and empty optional answers are dropped. */
export function validateAnswers(questions: Question[], raw: Record<string, unknown>): { ok: true; answers: Answers } | { ok: false; questionId: string } {
  const answers: Answers = {};
  for (const q of questions) {
    const value = raw[q.id];
    if (q.type === "checkboxes") {
      if (value !== undefined && (!Array.isArray(value) || !value.every((v) => typeof v === "string"))) return { ok: false, questionId: q.id };
      const picked = ((value as string[] | undefined) ?? []).map((v) => v.trim());
      if (new Set(picked).size !== picked.length || !picked.every((v) => q.options!.includes(v))) return { ok: false, questionId: q.id };
      if (picked.length) answers[q.id] = picked; else if (q.required) return { ok: false, questionId: q.id };
      continue;
    }
    if (value !== undefined && typeof value !== "string") return { ok: false, questionId: q.id };
    const text = (value ?? "").trim();
    if (!text) { if (q.required) return { ok: false, questionId: q.id }; continue; }
    if (q.type === "choice" && !q.options!.includes(text)) return { ok: false, questionId: q.id };
    if (text.length > (q.type === "paragraph" ? questionLimits.paragraph : questionLimits.short)) return { ok: false, questionId: q.id };
    answers[q.id] = text;
  }
  return { ok: true, answers };
}
