import { describe, expect, it } from "vitest";
import { defaultBrand, newBlock, newId } from "@/lib/email/blocks";
import { automationCreate, automationPatch, maxSteps, stepsSchema, triggerSchema } from "@/lib/newsletter-automations";
import { newsletterAutomationsEnabled } from "@/server/newsletter-automations";

const doc = { version: 2 as const, brand: { ...defaultBrand, address: "1 Main Street" }, blocks: [newBlock("text", { text: "Hi" }, newId())] };
const email = (extra = {}) => ({ id: newId(), type: "email" as const, subject: "Hello", preheader: "", content: doc, ...extra });
const wait = (amount = 1, unit: "hours" | "days" = "days") => ({ id: newId(), type: "wait" as const, amount, unit });
const end = () => ({ id: newId(), type: "end" as const });
const listId = "3f1c1d44-1f0e-4f43-a5f1-0d9a9b1d6a11";

describe("automation steps", () => {
  it("accepts email, wait and end steps in order, with end last", () => {
    expect(stepsSchema.safeParse([email(), wait(), email(), end()]).success).toBe(true);
    expect(stepsSchema.safeParse([]).success).toBe(true);
    expect(stepsSchema.safeParse([end(), email()]).success).toBe(false);
  });
  it("limits waits (1 to 720 hours, 1 to 60 days), the number of steps and unknown keys", () => {
    for (const bad of [wait(0), wait(721, "hours"), wait(61, "days"), { ...wait(), amount: 1.5 }, { ...wait(), unit: "weeks" }]) expect(stepsSchema.safeParse([bad]).success).toBe(false);
    expect(stepsSchema.safeParse([wait(720, "hours"), wait(60, "days")]).success).toBe(true);
    expect(stepsSchema.safeParse(Array.from({ length: maxSteps + 1 }, () => wait())).success).toBe(false);
    expect(stepsSchema.safeParse([{ ...email(), extra: 1 }]).success).toBe(false);
    expect(stepsSchema.safeParse([{ ...email(), subject: "  " }]).success).toBe(false);
  });
  it("keeps step ids unique and validates email content with the shared email document rules", () => {
    const a = email();
    expect(stepsSchema.safeParse([a, { ...wait(), id: a.id }]).success).toBe(false);
    expect(stepsSchema.safeParse([email({ content: { ...doc, blocks: [] } })]).success).toBe(false);
    expect(stepsSchema.safeParse([email({ content: { ...doc, brand: { ...doc.brand, logoUrl: "http://insecure.test/a.png" } } })]).success).toBe(false);
  });
});

describe("automation input", () => {
  it("takes exactly one trigger kind and a bounded name", () => {
    expect(triggerSchema.safeParse({ type: "list", listId }).success).toBe(true);
    expect(triggerSchema.safeParse({ type: "form", formId: listId }).success).toBe(true);
    expect(triggerSchema.safeParse({ type: "list", formId: listId }).success).toBe(false);
    expect(triggerSchema.safeParse({ type: "list", listId, formId: listId }).success).toBe(false);
    expect(automationCreate.safeParse({ name: "Welcome", trigger: { type: "list", listId } }).success).toBe(true);
    expect(automationCreate.safeParse({ name: " ", trigger: { type: "list", listId } }).success).toBe(false);
    expect(automationCreate.safeParse({ name: "x".repeat(101), trigger: { type: "list", listId } }).success).toBe(false);
    expect(automationPatch.safeParse({ version: 1, state: "draft" }).success).toBe(false);
    expect(automationPatch.safeParse({ version: 1, state: "active" }).success).toBe(true);
    expect(automationPatch.safeParse({ name: "no version" }).success).toBe(false);
  });
});

describe("hard-off flag", () => {
  it("is off by default, needs the flag, and is never on in production", () => {
    expect(newsletterAutomationsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(newsletterAutomationsEnabled({ NODE_ENV: "development", HARVEST_NEWSLETTER_AUTOMATIONS: "0" })).toBe(false);
    expect(newsletterAutomationsEnabled({ NODE_ENV: "development", HARVEST_NEWSLETTER_AUTOMATIONS: "1" })).toBe(true);
    expect(newsletterAutomationsEnabled({ NODE_ENV: "production", HARVEST_NEWSLETTER_AUTOMATIONS: "1" })).toBe(false);
    expect(newsletterAutomationsEnabled({ NODE_ENV: "development", VERCEL_ENV: "production", HARVEST_NEWSLETTER_AUTOMATIONS: "1" })).toBe(false);
  });
});
