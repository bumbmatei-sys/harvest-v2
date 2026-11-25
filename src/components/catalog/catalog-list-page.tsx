import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listCatalog } from "@/server/free-catalog";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { CatalogList } from "@/components/catalog/catalog-list";
import type { CatalogKind, CatalogRow } from "@/lib/catalog";

/** Server shell of the owner list, shared by Courses (courses only) and Products (everything). Off in production with the server. */
export async function CatalogListPage({ params, kind }: { params: Promise<{ tenantId: string }>; kind: "all" | CatalogKind }) {
  if (!freeCatalogEnabled()) notFound();
  const t = await getTranslations("Catalog"), session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  const items = workspace ? await listCatalog(db, session.user.id, tenantId, null).catch(denied) : null;
  if (!workspace || !items) return <AccessState />;
  const initial = items.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })) as CatalogRow[];
  return <div className="min-w-0 space-y-6">
    <h1 className="text-[28px] font-semibold tracking-tight">{t(kind === "course" ? "coursesTitle" : "productsTitle")}</h1>
    <CatalogList tenantId={tenantId} kind={kind} initial={initial} canManage={can(workspace.role, "catalog:manage")} />
  </div>;
}
