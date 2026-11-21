import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listCrmForms } from "@/server/crm-forms";
import { destinationOptions } from "@/server/crm-form-options";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { FormsList } from "@/components/crm/forms/forms-list";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CrmForms");
  return { title: t("pageTitle") };
}

export default async function FormsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("CrmForms"), nav = await getTranslations("ComponentsAppShell");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "crm:forms_manage")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const [forms, destinations] = await Promise.all([listCrmForms(getDb(), session.user.id, tenantId), destinationOptions(getDb(), session.user.id, tenantId)]);
  return <FormsList tenantId={tenantId} forms={forms} destinationLabels={destinations.labels} backHref={`/workspaces/${tenantId}/crm/people`} backLabel={nav("people")} />;
}
