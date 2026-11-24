import { getTranslations } from "next-intl/server";
import { Church } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { MinistrySettingsForm } from "@/components/ministry-settings-form";
export default async function MinistrySettingsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("AppWorkspacesSettingsPage");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  return <div className="space-y-6">
    <header className="space-y-1">
      <Church className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-[28px] font-semibold tracking-tight">{t("ministrySettings")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
    </header>
    <MinistrySettingsForm tenantId={tenantId} current={workspace.audience} timeZone={workspace.timeZone} writable={can(workspace.role, "settings:write")} />
  </div>;
}
