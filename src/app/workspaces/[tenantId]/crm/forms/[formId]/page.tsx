import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getCrmForm } from "@/server/crm-forms";
import { assignableMembers, destinationOptions } from "@/server/crm-form-options";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { FormEditor } from "@/components/crm/forms/form-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CrmForms");
  return { title: t("pageTitle") };
}

export default async function FormEditorPage({ params }: { params: Promise<{ tenantId: string; formId: string }> }) {
  const t = await getTranslations("CrmForms");
  const session = await pageSession(), { tenantId, formId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(formId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "crm:forms_manage")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const form = await getCrmForm(db, session.user.id, tenantId, formId).catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; });
  if (!form) notFound();
  const [destinations, members] = await Promise.all([destinationOptions(db, session.user.id, tenantId), assignableMembers(db, session.user.id, tenantId)]);
  return <FormEditor tenantId={tenantId} formId={formId} initial={form.definition} revision={form.definition.revision} destinations={destinations.options} members={members} />;
}
