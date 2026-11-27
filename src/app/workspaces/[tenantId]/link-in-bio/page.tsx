import { appOrigin } from "@/lib/site-address";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { bioChoices, getBioPage } from "@/server/link-in-bio";
import { linkInBioEnabled } from "@/server/link-in-bio-mode";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { BioEditor } from "@/components/link-in-bio/bio-editor";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("LinkInBio"); return { title: t("pageTitle") }; }

// The owner's editor. The page is created empty the first time an owner or admin opens it.
export default async function LinkInBioPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!linkInBioEnabled()) notFound();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const denied = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const workspace = await getWorkspace(db, user, tenantId).catch(denied);
  if (!workspace) return <AccessState />;
  const page = await getBioPage(db, user, tenantId).catch(denied);
  if (!page) return <AccessState />;
  const choices = await bioChoices(db, user, tenantId).catch(() => ({ communities: [], signups: [] }));
  return <BioEditor origin={appOrigin()} tenantId={tenantId} initial={page} choices={choices} ministryName={workspace.name} brandTheme={workspace.brandTheme} base="" messagesHref={`/workspaces/${tenantId}/link-in-bio/messages`} />;
}
