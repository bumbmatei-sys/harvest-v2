import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled } from "@/server/newsletter";
import { getCrmForm } from "@/server/crm-forms";
import { newsletterListChoices, newsletterSignupCounts } from "@/server/newsletter-forms";
import { syntheticCrmFormsKey } from "@/server/crm-form-mode";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { FormEditor } from "@/components/crm/forms/form-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterForms");
  return { title: t("editorTitle") };
}

const tabs = ["build", "settings", "preview", "share", "signups"] as const;

export default async function SignupFormEditorPage({ params, searchParams }: { params: Promise<{ tenantId: string; formId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterForms");
  const session = await pageSession(), { tenantId, formId } = await params, query = await searchParams;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(formId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:manage")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const form = await getCrmForm(db, session.user.id, tenantId, formId).catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; });
  if (!form?.definition.newsletter) notFound();
  const [lists, counts] = await Promise.all([newsletterListChoices(db, session.user.id, tenantId), newsletterSignupCounts(db, session.user.id, tenantId, formId)]);
  const initialTab = tabs.find((tab) => tab === query.tab);
  return <FormEditor ministryName={workspace.name} tenantId={tenantId} formId={formId} initial={form.definition} revision={form.definition.revision} destinations={[]} members={[]}
    responseCount={form.responseCount} publication={form.publication} unpublishedChanges={form.unpublishedChanges} hostedAvailable={syntheticCrmFormsKey() !== null}
    newsletter={{ lists, counts }} initialTab={initialTab} />;
}
