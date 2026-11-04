import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/db/client";
import { listWorkspaces } from "@/server/workspaces";
import { WorkspaceForm } from "@/components/workspace-form";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
export const dynamic = "force-dynamic";
export default async function Workspaces() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const workspaces = await listWorkspaces(getDb(), session.user.id);
  return <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
    <h1 className="text-2xl font-semibold">Your workspaces</h1>
    {workspaces.length ? <ul className="space-y-3">{workspaces.map((w) => <li key={w.tenantId}><Card><CardHeader><CardTitle>{w.name}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Role: {w.role}</p></CardContent></Card></li>)}</ul> : <Empty><EmptyHeader><EmptyTitle>You don’t have a workspace yet.</EmptyTitle><EmptyDescription>Create your first one below.</EmptyDescription></EmptyHeader></Empty>}
    <WorkspaceForm />
  </main>;
}
