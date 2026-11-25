import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { listCommunities } from "@/server/communities";
import { listFiles } from "@/server/files/service";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { catalogKinds, type CatalogFile, type CatalogKind } from "@/lib/catalog";
import { AccessState } from "@/components/access-state";
import { CatalogEditor } from "@/components/catalog/catalog-editor";

export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("Catalog"))("newProduct") }; }

export default async function NewCatalogItemPage({ params }: { params: Promise<{ tenantId: string; kind: string }> }) {
  if (!freeCatalogEnabled()) notFound();
  const session = await pageSession(), { tenantId, kind } = await params;
  if (!catalogKinds.includes(kind as CatalogKind)) notFound();
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch(denied);
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "catalog:manage")) return <AccessState href={`/workspaces/${tenantId}/products`} />;
  const [communities, files] = await Promise.all([listCommunities(db, session.user.id, tenantId).catch(denied),
    kind === "download" ? listFiles(db, session.user.id, tenantId).catch(denied) : Promise.resolve([])]);
  return <CatalogEditor tenantId={tenantId} kind={kind as CatalogKind} initial={null} host={workspace.name} writable
    communities={(communities ?? []).map(({ id, name }) => ({ id, name }))} files={JSON.parse(JSON.stringify(files ?? [])) as CatalogFile[]} />;
}
