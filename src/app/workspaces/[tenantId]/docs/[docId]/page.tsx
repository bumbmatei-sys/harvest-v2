import { appOrigin } from "@/lib/site-address";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { docsEnabled, getDoc, getPage } from "@/server/docs";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { DocEditor } from "@/components/docs/doc-editor";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Docs");
  return { title: t("pageTitle") };
}

export default async function DocPage({ params, searchParams }: { params: Promise<{ tenantId: string; docId: string }>; searchParams: Promise<{ page?: string }> }) {
  if (!docsEnabled()) notFound();
  const session = await pageSession(), { tenantId, docId } = await params, { page } = await searchParams;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(docId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const workspace = await getWorkspace(db, user, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const missing = (error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; };
  const detail = await getDoc(db, user, tenantId, docId).catch(missing);
  if (!detail) notFound();
  const visible = detail.pages.filter((p) => !p.archivedAt);
  const first = visible.filter((p) => p.parentId === null).sort((a, b) => a.position - b.position)[0] ?? visible[0];
  const wanted = page && uuidInput.safeParse(page).success && detail.pages.some((p) => p.id === page) ? page : first?.id;
  if (!wanted) notFound();
  const current = await getPage(db, user, tenantId, docId, wanted).catch(missing);
  if (!current) notFound();
  return <DocEditor origin={appOrigin()} key={wanted} tenantId={tenantId} detail={detail} page={current} userId={user} />;
}
