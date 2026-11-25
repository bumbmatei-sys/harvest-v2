import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { CatalogTypeCards } from "@/components/catalog/catalog-type-cards";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("Catalog"))("newProduct") }; }

/** "New product": pick a type, each with its own art. Picking opens that type's editor; nothing is created until the owner saves. */
export default async function NewProductPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!freeCatalogEnabled()) notFound();
  const t = await getTranslations("Catalog"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "catalog:manage")) return <AccessState href={`/workspaces/${tenantId}/products`} />;
  return <div className="min-w-0 space-y-6">
    <h1 className="text-[28px] font-semibold tracking-tight">{t("newProduct")}</h1>
    <h2 id="catalog-type-heading" className="text-base font-semibold">{t("types.heading")}</h2>
    <CatalogTypeCards tenantId={tenantId} />
  </div>;
}
