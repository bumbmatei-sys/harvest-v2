import { z } from "zod";
import { CONNECT_RETENTION_POLICY } from "./connect-retention";

export const intakePurposes = ["outreach_follow_up", "newsletter", "account_communications"] as const;
export type IntakePurpose = typeof intakePurposes[number];
export const intakeDefinition = z.object({ kind: z.enum(["connect-intake-v1", "connect-intake-v2", "connect-intake-v3"]), syntheticOnly: z.literal(true),
  preferredName: z.boolean(), followUpChannel: z.enum(["email", "phone"]) }).strict();
export const intakeSetup = z.object({ formId: z.uuid().optional(), name: z.string().trim().min(1).max(200),
  definition: intakeDefinition, purposes: z.array(z.enum(intakePurposes)).min(1).max(3).refine(v => new Set(v).size === v.length),
  notice: z.string().trim().min(1).max(19000), retentionDays: z.number().int().min(1).max(CONNECT_RETENTION_POLICY.maxPendingDays) }).strict().refine(v => v.definition.followUpChannel === "email" && (v.definition.kind !== "connect-intake-v1" || !v.purposes.includes("account_communications")));
export const intakeSubmission = z.object({ submissionId: z.uuid(), receiptToken: z.string().regex(/^[a-f0-9]{64}$/),
  stamp: z.string().regex(/^[a-f0-9]{64}$/), capability: z.string().regex(/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/), purposes: z.array(z.enum(intakePurposes)).min(1).max(3).refine(v => new Set(v).size === v.length),
  preferredName: z.string().trim().max(80).default(""), email: z.string().trim().max(254).default(""),
  phone: z.string().trim().max(32).default(""), website: z.string().max(200).default("") }).strict();
export const intakeRights = z.object({ receiptToken: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["withdraw", "erase"]), purpose: z.enum(intakePurposes).optional() }).strict()
  .refine(v => v.action !== "withdraw" || v.purpose !== undefined);
export type IntakeManifest = { receiptToken: string; stamp: string; capability: string; definition: z.infer<typeof intakeDefinition>; purposes: IntakePurpose[]; notice: string; retentionDays: number };
