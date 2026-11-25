import { z } from "zod";
import { emailDocumentSchema, newId, type EmailDocument } from "./email/blocks";

export const automationStates = ["draft", "active", "paused"] as const;
export const automationTriggers = ["form", "list"] as const;
export const waitUnits = ["hours", "days"] as const;
export const maxSteps = 12;
export const maxWait = { hours: 720, days: 60 } as const;

const id = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/);
export const emailStepSchema = z.object({ id, type: z.literal("email"), subject: z.string().trim().min(1).max(150), preheader: z.string().max(200), content: emailDocumentSchema }).strict();
export const waitStepSchema = z.object({ id, type: z.literal("wait"), amount: z.number().int().min(1).max(720), unit: z.enum(waitUnits) }).strict()
  .refine((step) => step.amount <= maxWait[step.unit], { path: ["amount"] });
export const endStepSchema = z.object({ id, type: z.literal("end") }).strict();
export const stepSchema = z.discriminatedUnion("type", [emailStepSchema, waitStepSchema, endStepSchema]);
export type AutomationStep = z.infer<typeof stepSchema>;
export type EmailStep = z.infer<typeof emailStepSchema>;

/** Steps run in order; "end" (when present) must be last, and ids are unique. */
export const stepsSchema = z.array(stepSchema).max(maxSteps).refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length)
  .refine((steps) => steps.every((s, i) => s.type !== "end" || i === steps.length - 1));

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("form"), formId: z.uuid() }).strict(),
  z.object({ type: z.literal("list"), listId: z.uuid() }).strict(),
]);
export type AutomationTrigger = z.infer<typeof triggerSchema>;

export const automationInput = z.object({ name: z.string().trim().min(1).max(100), trigger: triggerSchema, steps: stepsSchema }).strict();
export const automationCreate = automationInput.partial({ steps: true });
export const automationPatch = z.object({ version: z.number().int().positive().max(2_147_483_646), name: z.string().trim().min(1).max(100).optional(),
  trigger: triggerSchema.optional(), steps: stepsSchema.optional(), state: z.enum(["active", "paused"]).optional() }).strict();

export const stopReasons = ["consent_withdrawn", "unsubscribed", "suppressed", "no_address", "image_unavailable", "automation_changed"] as const;

export function newStep(type: AutomationStep["type"], brand: EmailDocument["brand"], blocks: EmailDocument["blocks"], copy: { subject: string }): AutomationStep {
  if (type === "wait") return { id: newId(), type, amount: 1, unit: "days" };
  if (type === "end") return { id: newId(), type };
  return { id: newId(), type: "email", subject: copy.subject, preheader: "", content: { version: 2, brand, blocks } };
}
