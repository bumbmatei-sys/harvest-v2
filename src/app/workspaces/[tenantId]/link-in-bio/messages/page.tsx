import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { listBioMessages } from "@/server/link-in-bio";
import { linkInBioEnabled } from "@/server/link-in-bio-mode";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { BioMessages } from "@/components/link-in-bio/bio-messages";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations("LinkInBio.inbox"); return { title: t("title") }; }

export default async function LinkInBioMessagesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!linkInBioEnabled()) notFound();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const data = await listBioMessages(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!data) return <AccessState />;
  return <BioMessages tenantId={tenantId} initial={data.messages} available={data.available} />;
}
