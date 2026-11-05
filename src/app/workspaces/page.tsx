import { getTranslations } from "next-intl/server";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/db/client";
import { listWorkspaces } from "@/server/workspaces";
import { WorkspaceForm } from "@/components/workspace-form";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { AppShell } from "@/components/app-shell";
import { ArrowRight, Building2 } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function Workspaces() {
  const t = await getTranslations("AppWorkspacesPage");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const workspaces = await listWorkspaces(getDb(), session.user.id);
  return <AppShell defaultOpen={defaultOpen} workspaces={workspaces} email={session.user.email}><div className="space-y-8">
    <div><p className="mb-3 text-xs text-muted-foreground">{t("yOURHARVEST")}</p><h1 className="text-[28px] font-semibold tracking-tight">{t("yourWorkspaces")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("aHomeForYourPeopleAndTheWork")}</p></div>
    {workspaces.length ? <ul className="grid gap-3 sm:grid-cols-2">{workspaces.map((w) => <li key={w.tenantId}><Card><CardHeader><Building2 className="mb-3 size-5 text-muted-foreground" aria-hidden="true" /><CardTitle>{w.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-xs text-muted-foreground">{t("roleValue", { role: t(`roles.${w.role}`) })}</p><Button variant="outline" size="sm" asChild><Link href={`/workspaces/${w.tenantId}/contacts`}>{t("openWorkspace")}<ArrowRight aria-hidden="true" /></Link></Button><Button variant="outline" size="sm" asChild><Link href={`/workspaces/${w.tenantId}/files`}>{t("files")}</Link></Button></CardContent></Card></li>)}</ul> : <Empty className="items-start p-0 text-left md:p-0"><EmptyHeader className="items-start text-left"><EmptyTitle>{t("noWorkspacesYet")}</EmptyTitle><EmptyDescription>{t("youDonTHaveAWorkspaceYetCreate")}</EmptyDescription></EmptyHeader></Empty>}
    <Card className="max-w-lg"><CardHeader><CardTitle>{t("createAWorkspace")}</CardTitle><CardDescription>{t("giveYourNextChapterAPlaceToGrow")}</CardDescription></CardHeader><CardContent><WorkspaceForm /></CardContent></Card>
  </div></AppShell>;
}
