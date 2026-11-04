import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth-instance";
import { getDb } from "@/db/client";
import { workspaces } from "@/db/schema";
import { listFiles } from "@/server/files/service";
import { withTenant } from "@/server/tenancy";
import { AccessError } from "@/server/permissions";
import { UploadControl } from "@/components/files/upload-control";
import { FileList } from "@/components/files/file-list";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export const dynamic = "force-dynamic";
export default async function FilesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const parsed = z.uuid().safeParse((await params).tenantId);
  if (!parsed.success) notFound();
  const tenantId = parsed.data;
  let workspace, files;
  try {
    [workspace, files] = await Promise.all([
      withTenant(getDb(), session.user.id, tenantId, "workspace:read", async (tx, id, role) => {
        const [row] = await tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.tenantId, id));
        return { name: row.name, canUpload: role !== "viewer" };
      }),
      listFiles(getDb(), session.user.id, tenantId),
    ]);
  } catch (error) { if (error instanceof AccessError) notFound(); throw error; }
  return <div className="space-y-6">
    <Button asChild variant="outline"><Link href="/workspaces">Back to workspaces</Link></Button>
    <div className="space-y-1"><p className="text-sm text-muted-foreground">{workspace.name}</p><h1 className="text-2xl font-semibold">Workspace files</h1></div>
    <Card><CardHeader><CardTitle>Upload a file</CardTitle></CardHeader><CardContent><UploadControl tenantId={tenantId} canUpload={workspace.canUpload} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Files</CardTitle></CardHeader><CardContent><FileList files={files} tenantId={tenantId} canUpload={workspace.canUpload} /></CardContent></Card>
  </div>;
}
