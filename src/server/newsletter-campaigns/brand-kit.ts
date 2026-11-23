import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { newsletterBrandKits } from "../../db/schema";
import { brandKitSchema, defaultBrand } from "../../lib/email/blocks";
import { audit, conflict, version, withNewsletter } from "./access";

const writeInput = z.object({ kit: brandKitSchema, version: version.optional() }).strict();

/** The ministry's default brand kit; the built-in default until the first save. */
export function getBrandKit(db: Database, actor: string, workspace: string) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const [row] = await tx.select().from(newsletterBrandKits).where(eq(newsletterBrandKits.tenantId, tenant));
    return row ? { kit: row.kit, version: row.version, saved: true } : { kit: defaultBrand, version: 0, saved: false };
  });
}

export function saveBrandKit(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:campaigns", async (tx, tenant) => {
    const input = writeInput.parse(raw);
    const [row] = await tx.select().from(newsletterBrandKits).where(eq(newsletterBrandKits.tenantId, tenant)).for("update");
    if (!row) {
      if (input.version) throw conflict("STALE_VERSION");
      const [created] = await tx.insert(newsletterBrandKits).values({ tenantId: tenant, kit: input.kit }).onConflictDoNothing().returning();
      if (!created) throw conflict("STALE_VERSION");
      await audit(tx, tenant, actor, "newsletter.brand_kit.save", tenant, 1);
      return { kit: created.kit, version: created.version, saved: true };
    }
    if (input.version !== row.version) throw conflict("STALE_VERSION");
    const [updated] = await tx.update(newsletterBrandKits).set({ kit: input.kit, version: row.version + 1, updatedAt: sql`now()` })
      .where(eq(newsletterBrandKits.tenantId, tenant)).returning();
    await audit(tx, tenant, actor, "newsletter.brand_kit.save", tenant, updated.version);
    return { kit: updated.kit, version: updated.version, saved: true };
  });
}
