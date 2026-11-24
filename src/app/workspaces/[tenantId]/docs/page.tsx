import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { docsEnabled, listDocs } from "@/server/docs";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { DocsScreen } from "@/components/docs/docs-screen";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Docs");
  return { title: t("pageTitle") };
}

// The Docs list: folders on top, the docs of the open folder (or the search results across folders) below. The view lives in the URL, so a reload or a shared link shows the same list.
export default async function DocsPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!docsEnabled()) notFound();
  const session = await pageSession(), { tenantId } = await params, raw = await searchParams;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const workspace = await getWorkspace(db, user, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const one = (key: string) => { const v = raw[key]; return typeof v === "string" && v ? v : undefined; };
  const query = { folderId: one("folder"), q: one("q"), status: one("status"), sort: one("sort"), favorites: one("favorites") };
  // A malformed or foreign folder id in the URL shows the top level instead of an error.
  const list = await listDocs(db, user, tenantId, query).catch(async (error: unknown) => { if (error instanceof Error && error.name === "ZodError") return listDocs(db, user, tenantId, {}); throw error; });
  const folderId = query.folderId && list.folders.some((f) => f.id === query.folderId) ? query.folderId : null;
  const status = query.status === "archived" || query.status === "trash" ? query.status : "active";
  return <DocsScreen tenantId={tenantId} list={list} folderId={folderId} q={query.q ?? ""} status={status} sort={query.sort === "title" ? "title" : "updated"} favorites={query.favorites === "1"} />;
}
