import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireOfficeScreens } from "@/server/office-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { OfficeMail } from "@/components/office/mail/mail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("OfficeMail");
  return { title: t("pageTitle") };
}

// Office Mail screen. 404 before any session work while the non-production Office gate is closed; owner and admin only (neutral answer for everyone else).
// Mail is fetched by the browser from the Office routes for the signed-in person's own connection; this page reads no mailbox content.
export default async function MailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  requireOfficeScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "office:mail")) return <AccessState />;
  return <OfficeMail tenantId={tenantId} />;
}
