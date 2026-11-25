import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { automationOptions, getAutomation, newsletterAutomationsEnabled } from "@/server/newsletter-automations";
import { getBrandKit } from "@/server/newsletter-campaigns/brand-kit";
import { thumbnailSuggestionsEnabled } from "@/server/newsletter-campaigns/images";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AutomationEditor } from "@/components/newsletter/automation-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterAutomations");
  return { title: t("pageTitle") };
}

export default async function AutomationEditorPage({ params }: { params: Promise<{ tenantId: string; automationId: string }> }) {
  if (!newsletterAutomationsEnabled()) notFound();
  const t = await getTranslations("NewsletterCampaigns");
  const session = await pageSession(), { tenantId, automationId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(automationId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const workspace = await getWorkspace(db, user, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:campaigns")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const automation = await getAutomation(db, user, tenantId, automationId).catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; });
  if (!automation) notFound();
  const [kit, options] = await Promise.all([getBrandKit(db, user, tenantId), automationOptions(db, user, tenantId)]);
  const triggerName = automation.trigger.type === "list" ? options.lists.find((l) => l.id === automation.trigger.listId)?.name : options.forms.find((f) => f.id === (automation.trigger as { formId: string }).formId)?.name;
  return <AutomationEditor tenantId={tenantId} ministryName={workspace.name} brand={kit.kit} suggestions={thumbnailSuggestionsEnabled()} triggerName={triggerName ?? ""}
    automation={{ id: automation.id, name: automation.name, state: automation.state, version: automation.version, trigger: automation.trigger, steps: automation.steps }} />;
}
