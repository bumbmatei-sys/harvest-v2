import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { getCatalogDraft } from "@/server/free-catalog";
import { listCommunities } from "@/server/communities";
import { listFiles } from "@/server/files/service";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import type { CatalogFile, CatalogItem } from "@/lib/catalog";
import { AccessState } from "@/components/access-state";
import { CatalogEditor } from "@/components/catalog/catalog-editor";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("Catalog"))("productsTitle") }; }

export default async function CatalogItemPage({ params }: { params: Promise<{ tenantId: string; itemId: string }> }) {
  if (!freeCatalogEnabled()) notFound();
  const session = await pageSession(), { tenantId, itemId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  if (!uuidInput.safeParse(itemId).success) notFound();
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  if (!workspace) return <AccessState />;
  // Hidden, archived-from-view and foreign items answer the same unavailable state as a missing one.
  const item = await getCatalogDraft(db, session.user.id, tenantId, itemId).catch(denied);
  if (!item) notFound();
  const writable = can(workspace.role, "catalog:manage");
  const [communities, files] = writable ? await Promise.all([listCommunities(db, session.user.id, tenantId).catch(denied),
    item.kind === "download" ? listFiles(db, session.user.id, tenantId).catch(denied) : Promise.resolve([])]) : [[], []];
  return <CatalogEditor tenantId={tenantId} kind={item.kind} host={workspace.name} writable={writable}
    initial={JSON.parse(JSON.stringify(item)) as CatalogItem} communities={(communities ?? []).map(({ id, name }) => ({ id, name }))}
    files={JSON.parse(JSON.stringify(files ?? [])) as CatalogFile[]} />;
}
