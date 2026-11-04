import { headers } from "next/headers";
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
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const workspaces = await listWorkspaces(getDb(), session.user.id);
  return <AppShell workspaces={workspaces} email={session.user.email}><div className="space-y-8">
    <div><p className="mb-3 text-xs text-muted-foreground">YOUR HARVEST</p><h1 className="text-[28px] font-semibold tracking-tight">Your workspaces</h1><p className="mt-2 text-sm text-muted-foreground">A home for your people and the work you do together.</p></div>
    {workspaces.length ? <ul className="grid gap-3 sm:grid-cols-2">{workspaces.map((w) => <li key={w.tenantId}><Card><CardHeader><Building2 className="mb-3 size-5 text-muted-foreground" aria-hidden="true" /><CardTitle>{w.name}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-xs text-muted-foreground">Role: {w.role}</p><Button variant="outline" size="sm" asChild><Link href={`/workspaces/${w.tenantId}/contacts`}>Open workspace<ArrowRight aria-hidden="true" /></Link></Button><Button variant="outline" size="sm" asChild><Link href={`/workspaces/${w.tenantId}/files`}>Files</Link></Button></CardContent></Card></li>)}</ul> : <Empty className="items-start p-0 text-left md:p-0"><EmptyHeader className="items-start text-left"><EmptyTitle>No workspaces yet</EmptyTitle><EmptyDescription>You don’t have a workspace yet. Create your first one below.</EmptyDescription></EmptyHeader></Empty>}
    <Card className="max-w-lg"><CardHeader><CardTitle>Create a workspace</CardTitle><CardDescription>Give your next chapter a place to grow.</CardDescription></CardHeader><CardContent><WorkspaceForm /></CardContent></Card>
  </div></AppShell>;
}
