import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { destinationOptions } from "@/server/crm-form-options";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { FormNew } from "@/components/crm/forms/form-new";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CrmForms");
  return { title: t("newPageTitle") };
}

export default async function NewFormPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ template?: string }> }) {
  const t = await getTranslations("CrmForms");
  const session = await pageSession(), { tenantId } = await params, { template } = await searchParams;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "crm:forms_manage")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const destinations = await destinationOptions(getDb(), session.user.id, tenantId);
  return <FormNew tenantId={tenantId} destinations={destinations.options} template={template ?? null} />;
}
