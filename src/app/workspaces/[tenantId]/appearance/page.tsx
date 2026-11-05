import { getTranslations } from "next-intl/server";
import { Palette } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AppearanceForm } from "@/components/appearance-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export default async function AppearancePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("AppWorkspacesAppearancePage");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  return <div className="max-w-xl space-y-6"><div><Palette className="mb-4 size-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-[28px] font-semibold tracking-tight">{t("appearance")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("makeThisWorkspaceFeelLikeYours")}</p></div><Card><CardHeader><CardTitle className="text-sm">{t("workspaceTheme")}</CardTitle></CardHeader><CardContent><AppearanceForm tenantId={tenantId} current={workspace.brandTheme} writable={can(workspace.role, "settings:write")} /></CardContent></Card><p className="text-xs leading-relaxed text-muted-foreground">{t("yourToolbarPreferenceTakesPriorityOverTheWorkspace")}</p></div>;
}
