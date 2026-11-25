import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { automationOptions, listAutomations, newsletterAutomationsEnabled } from "@/server/newsletter-automations";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AutomationsList } from "@/components/newsletter/automations-list";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterAutomations");
  return { title: t("pageTitle") };
}

export default async function AutomationsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!newsletterAutomationsEnabled()) notFound();
  const t = await getTranslations("NewsletterCampaigns");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const workspace = await getWorkspace(db, user, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:campaigns")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const [page, options] = await Promise.all([listAutomations(db, user, tenantId), automationOptions(db, user, tenantId)]);
  const names = { lists: Object.fromEntries(options.lists.map((l) => [l.id, l.name])), forms: Object.fromEntries(options.forms.map((f) => [f.id, f.name])) };
  const rows = page.items.map((a) => ({ id: a.id, name: a.name, state: a.state, trigger: a.trigger, stepCount: a.stepCount, running: a.running, completed: a.completed, stopped: a.stopped }));
  return <AutomationsList tenantId={tenantId} automations={rows} options={options} names={names} />;
}
