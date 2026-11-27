import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { contacts, newsletterAutomationLog as logTable, newsletterAutomationRuns as runsTable, newsletterAutomations as automations, newsletterLists, newsletterSettings } from "../db/schema";
import { eachDay, periodRange } from "../lib/newsletter-analytics";
import { message } from "../i18n/messages";
import { documentImages } from "./newsletter-campaigns/access";
import { audit, conflict, id as uuidId, unavailable, withNewsletter } from "./newsletter-campaigns/access";
import { newsletterEnabled } from "./newsletter";
import { AccessError } from "./permissions";
import { automationCreate, automationPatch, type AutomationStep } from "../lib/newsletter-automations";

/** Hard-off: automations exist only outside production and only while the flag is set; sending goes to the synthetic provider only. */
export function newsletterAutomationsEnabled(env: Record<string, string | undefined> = process.env) {
  return newsletterEnabled(env) && env.VERCEL_ENV !== "production" && env.HARVEST_NEWSLETTER_AUTOMATIONS === "1";
}
export function requireAutomationsEnabled() {
  if (!newsletterAutomationsEnabled()) throw new AccessError(404, message("Errors.thisViewIsNotAvailable"));
}
const run = async <T>(db: Database, actor: string, workspace: string, fn: (tx: Transaction, tenant: string) => Promise<T>) => {
  requireAutomationsEnabled();
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", fn);
};
const bad = () => new AccessError(400, message("Errors.checkTheSuppliedDetails"));

type Row = typeof automations.$inferSelect;
const present = (row: Row) => ({ id: row.id, name: row.name, version: row.version, state: row.state, steps: row.steps as AutomationStep[],
  trigger: row.triggerType === "form" ? { type: "form" as const, formId: row.triggerFormId! } : { type: "list" as const, listId: row.triggerListId! },
  createdAt: row.createdAt, updatedAt: row.updatedAt });

async function checkTrigger(tx: Transaction, tenant: string, trigger: { type: "form"; formId: string } | { type: "list"; listId: string }) {
  if (trigger.type === "list") {
    const [list] = await tx.select({ id: newsletterLists.id }).from(newsletterLists).where(and(eq(newsletterLists.tenantId, tenant), eq(newsletterLists.id, trigger.listId), isNull(newsletterLists.archivedAt)));
    if (!list) throw bad();
  } else {
    const { rows } = await tx.execute(sql`select 1 from forms where tenant_id = ${tenant} and id = ${trigger.formId} and archived_at is null`);
    if (!rows.length) throw bad();
  }
}
/** Every uploaded image an email step uses must be ready now (the send re-checks). */
async function checkImages(tx: Transaction, tenant: string, steps: AutomationStep[]) {
  for (const step of steps) if (step.type === "email") await documentImages(tx, tenant, step.content);
}
const triggerColumns = (trigger: { type: "form"; formId: string } | { type: "list"; listId: string }) =>
  ({ triggerType: trigger.type, triggerFormId: trigger.type === "form" ? trigger.formId : null, triggerListId: trigger.type === "list" ? trigger.listId : null });

export async function listAutomations(db: Database, actor: string, workspace: string) {
  return run(db, actor, workspace, async (tx, tenant) => {
    const rows = await tx.select().from(automations).where(eq(automations.tenantId, tenant)).orderBy(desc(automations.createdAt), asc(automations.id)).limit(200);
    const counts = rows.length ? (await tx.execute<{ automation: string; state: string; n: number }>(sql`select automation_id::text as automation, state, count(*)::int as n
      from newsletter_automation_runs where tenant_id = ${tenant} group by automation_id, state`)).rows : [];
    return { items: rows.map((row) => {
      const mine = counts.filter((c) => c.automation === row.id), count = (state: string) => mine.find((c) => c.state === state)?.n ?? 0;
      return { ...present(row), steps: undefined, stepCount: (row.steps as unknown[]).length, running: count("active"), completed: count("completed"), stopped: count("stopped") };
    }) };
  });
}

export async function getAutomation(db: Database, actor: string, workspace: string, automation: string) {
  return run(db, actor, workspace, async (tx, tenant) => {
    const [row] = await tx.select().from(automations).where(and(eq(automations.tenantId, tenant), eq(automations.id, uuidId(automation))));
    if (!row) throw unavailable();
    return present(row);
  });
}

export async function createAutomation(db: Database, actor: string, workspace: string, raw: unknown) {
  const input = automationCreate.parse(raw);
  return run(db, actor, workspace, async (tx, tenant) => {
    await checkTrigger(tx, tenant, input.trigger);
    await checkImages(tx, tenant, input.steps ?? []);
    const [row] = await tx.insert(automations).values({ tenantId: tenant, name: input.name, createdBy: actor, steps: input.steps ?? [], ...triggerColumns(input.trigger) }).returning();
    await audit(tx, tenant, actor, "newsletter.automation.create", row.id, row.version);
    return present(row);
  });
}

const guardMessages: Record<string, number> = { newsletter_automation_pause_to_edit: 409, newsletter_automation_needs_email: 400, newsletter_automation_trigger_locked: 409, newsletter_automation_state: 400 };
export async function updateAutomation(db: Database, actor: string, workspace: string, automation: string, raw: unknown) {
  const input = automationPatch.parse(raw);
  return run(db, actor, workspace, async (tx, tenant) => {
    const [current] = await tx.select().from(automations).where(and(eq(automations.tenantId, tenant), eq(automations.id, uuidId(automation)))).for("update");
    if (!current) throw unavailable();
    if (current.version !== input.version) throw conflict("STALE_VERSION");
    if (input.trigger) await checkTrigger(tx, tenant, input.trigger);
    if (input.steps) await checkImages(tx, tenant, input.steps);
    // Activating re-checks every email step's images against what is ready now.
    if (input.state === "active") await checkImages(tx, tenant, (input.steps ?? current.steps) as AutomationStep[]);
    try {
      const [row] = await tx.update(automations).set({ version: current.version + 1, updatedAt: sql`now()`,
        ...(input.name ? { name: input.name } : {}), ...(input.steps ? { steps: input.steps } : {}), ...(input.state ? { state: input.state } : {}),
        ...(input.trigger ? triggerColumns(input.trigger) : {}) }).where(and(eq(automations.tenantId, tenant), eq(automations.id, current.id))).returning();
      await audit(tx, tenant, actor, input.state ? `newsletter.automation.${input.state === "active" ? "activate" : "pause"}` : "newsletter.automation.update", row.id, row.version);
      return present(row);
    } catch (error) {
      const text = String((error as { cause?: { message?: string }; message?: string })?.cause?.message ?? (error as Error)?.message ?? "");
      const code = Object.keys(guardMessages).find((key) => text.includes(key));
      if (code) throw new AccessError(guardMessages[code] as 400 | 409, message(guardMessages[code] === 409 ? "Errors.thisRecordChangedReloadAndTryAgain" : "Errors.checkTheSuppliedDetails"), { code: code.toUpperCase() });
      throw error;
    }
  });
}

const runsQuery = z.object({ state: z.enum(["active", "completed", "stopped"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
/** Who is in this automation and how far they are. Names are shown to owners and admins only (same access as the people list). */
export async function listAutomationRuns(db: Database, actor: string, workspace: string, automation: string, raw: unknown) {
  const query = runsQuery.parse(raw ?? {});
  return run(db, actor, workspace, async (tx, tenant) => {
    const rows = await tx.select({ id: runsTable.id, contactId: runsTable.contactId, name: contacts.name, state: runsTable.state, stopReason: runsTable.stopReason,
      stepIndex: runsTable.stepIndex, nextRunAt: runsTable.nextRunAt, startedAt: runsTable.startedAt, finishedAt: runsTable.finishedAt })
      .from(runsTable).innerJoin(contacts, and(eq(contacts.tenantId, runsTable.tenantId), eq(contacts.id, runsTable.contactId)))
      .where(and(eq(runsTable.tenantId, tenant), eq(runsTable.automationId, uuidId(automation)), query.state ? eq(runsTable.state, query.state) : undefined))
      .orderBy(desc(runsTable.startedAt), asc(runsTable.id)).limit(query.limit);
    return { items: rows };
  });
}

export async function getRunLog(db: Database, actor: string, workspace: string, automation: string, runId: string) {
  return run(db, actor, workspace, async (tx, tenant) => {
    const [owner] = await tx.select({ id: runsTable.id }).from(runsTable).where(and(eq(runsTable.tenantId, tenant), eq(runsTable.id, uuidId(runId)), eq(runsTable.automationId, uuidId(automation))));
    if (!owner) throw unavailable();
    const items = await tx.select({ id: logTable.id, stepIndex: logTable.stepIndex, stepType: logTable.stepType, outcome: logTable.outcome, reason: logTable.reason, at: logTable.at })
      .from(logTable).where(and(eq(logTable.tenantId, tenant), eq(logTable.runId, owner.id))).orderBy(asc(logTable.at), asc(logTable.id)).limit(200);
    return { items };
  });
}

/** Choices for the trigger picker: live lists and the ministry's sign-up forms. */
export async function automationOptions(db: Database, actor: string, workspace: string) {
  return run(db, actor, workspace, async (tx, tenant) => {
    const lists = await tx.select({ id: newsletterLists.id, name: newsletterLists.name }).from(newsletterLists)
      .where(and(eq(newsletterLists.tenantId, tenant), isNull(newsletterLists.archivedAt))).orderBy(asc(newsletterLists.name)).limit(200);
    const { rows } = await tx.execute<{ id: string; name: string }>(sql`select f.id::text as id, f.name from forms f
      where f.tenant_id = ${tenant} and f.archived_at is null and exists (select 1 from form_versions v where v.tenant_id = f.tenant_id and v.form_id = f.id
        and v.definition->>'kind' = 'crm-form-v1' and v.definition->'newsletter' is not null) order by lower(f.name), f.id limit 200`);
    return { lists, forms: rows };
  });
}

type AutomationClickReport = { total: number | string | null; days: { day: string; clicks: number | string | null }[];
  steps: { step: number; clicks: number | string | null }[]; links: { url: string; clicks: number | string }[] };
export type AutomationClicks = { counting: boolean; total: number | null; days: { day: string; clicks: number | null }[];
  steps: { step: number; clicks: number | null }[]; links: { url: string; clicks: number }[] };

/**
 * Link clicks on one automation's emails over the last 90 UTC days, the same rules as campaigns: totals per step, per day and per link only, every group
 * under 5 withheld (null) by the definer per step, UTC day and link, owners and admins only (a delegated grant is not enough). Nothing about who clicked exists in the result.
 */
export async function automationClicks(db: Database, actor: string, workspace: string, automation: string, now = new Date()): Promise<AutomationClicks> {
  requireAutomationsEnabled();
  const range = periodRange(90, now);
  return withNewsletter(db, actor, workspace, "newsletter:analytics", async (tx, tenant, _role, access) => {
    if (access !== "owner" && access !== "admin") throw unavailable();
    const [row] = await tx.select({ id: automations.id }).from(automations).where(and(eq(automations.tenantId, tenant), eq(automations.id, uuidId(automation))));
    if (!row) throw unavailable();
    const { rows: [{ report }] } = await tx.execute<{ report: AutomationClickReport }>(sql`
      select public.newsletter_automation_click_report(${tenant}::uuid,${row.id}::uuid,${range.from}::date,${range.until}::date) as report`);
    const [setting] = await tx.select({ on: newsletterSettings.clickTracking }).from(newsletterSettings).where(eq(newsletterSettings.tenantId, tenant));
    const toNumber = (value: number | string | null) => value === null ? null : Number(value);
    const byDay = new Map(report.days.map((day) => [day.day, toNumber(day.clicks)]));
    const all = eachDay(range), first = all.findIndex((day) => byDay.has(day));
    const days = all.slice(first < 0 ? all.length - 7 : Math.min(first, all.length - 7)).map((day) => ({ day, clicks: byDay.has(day) ? byDay.get(day)! : 0 }));
    return { counting: setting?.on ?? false, total: toNumber(report.total), days,
      steps: report.steps.map((step) => ({ step: step.step, clicks: toNumber(step.clicks) })),
      links: report.links.map((link) => ({ url: link.url, clicks: Number(link.clicks) })) };
  });
}
