import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { newsletterTemplates, newsletterTemplateRevisions } from "../../db/schema";
import { newsletterContent, newsletterStarters } from "../../lib/newsletter-content";
import { audit, campaignPreview, conflict, id, pageInput, unavailable, version, withNewsletter } from "./access";

const templateInput = z.object({ name: z.string().trim().min(1).max(100), content: newsletterContent }).strict();
const editInput = templateInput.extend({ version });
const archiveInput = z.object({ version }).strict();

export async function readTemplate(tx: Transaction, tenant: string, templateId: string, lock = false) {
  const scope = and(eq(newsletterTemplates.tenantId, tenant), eq(newsletterTemplates.id, id(templateId)),
    eq(newsletterTemplates.archived, false));
  const query = tx.select().from(newsletterTemplates).where(scope);
  const [template] = lock ? await query.for("update") : await query;
  if (!template) throw unavailable();
  const [revision] = await tx.select().from(newsletterTemplateRevisions).where(and(eq(newsletterTemplateRevisions.tenantId, tenant),
    eq(newsletterTemplateRevisions.templateId, template.id), eq(newsletterTemplateRevisions.version, template.version)));
  if (!revision) throw unavailable();
  return { ...template, content: revision.content };
}

export function listTemplates(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const page = pageInput.parse(raw);
    const rows = await tx.select().from(newsletterTemplates).where(and(eq(newsletterTemplates.tenantId, tenant),
      eq(newsletterTemplates.archived, false), page.after ? gt(newsletterTemplates.id, page.after) : undefined))
      .orderBy(asc(newsletterTemplates.id)).limit(page.limit + 1);
    return { items: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
      starters: newsletterStarters };
  });
}

export function getTemplate(db: Database, actor: string, workspace: string, template: string) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", (tx, tenant) => readTemplate(tx, tenant, template));
}

export function writeTemplate(db: Database, actor: string, workspace: string, raw: unknown, template?: string) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const input = template ? editInput.parse(raw) : templateInput.parse(raw);
    await campaignPreview(tx, tenant, input.content);
    let row;
    if (template) {
      const old = await readTemplate(tx, tenant, template, true);
      if (!("version" in input) || old.version !== input.version) throw conflict("STALE_VERSION");
      [row] = await tx.update(newsletterTemplates).set({ name: input.name, version: old.version + 1 })
        .where(and(eq(newsletterTemplates.tenantId, tenant), eq(newsletterTemplates.id, old.id))).returning();
    } else {
      [row] = await tx.insert(newsletterTemplates).values({ tenantId: tenant, name: input.name }).returning();
    }
    await tx.insert(newsletterTemplateRevisions).values({ tenantId: tenant, templateId: row.id, version: row.version, content: input.content });
    await audit(tx, tenant, actor, template ? "newsletter.template.edit" : "newsletter.template.create", row.id, row.version);
    return { ...row, content: input.content };
  });
}

export function archiveTemplate(db: Database, actor: string, workspace: string, template: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const old = await readTemplate(tx, tenant, template, true);
    if (old.version !== archiveInput.parse(raw).version) throw conflict("STALE_VERSION");
    await tx.update(newsletterTemplates).set({ archived: true, version: old.version + 1 })
      .where(and(eq(newsletterTemplates.tenantId, tenant), eq(newsletterTemplates.id, old.id)));
    await audit(tx, tenant, actor, "newsletter.template.archive", old.id, old.version + 1);
    return { id: old.id, archived: true, version: old.version + 1 };
  });
}
