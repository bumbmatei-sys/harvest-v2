"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
type FileRow = { id: string; name: string; size: number; status: string; visibility: string; canConfirm: boolean; publicUrl: string | null };
export function FileList({ files, tenantId, canUpload }: { files: FileRow[]; tenantId: string; canUpload: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  async function act(file: FileRow, action: "download" | "confirm") {
    setBusyId(file.id); setError("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/files/${file.id}/${action}`, { method: action === "confirm" ? "POST" : "GET" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (action === "download") window.location.assign(data.url);
      else router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open file. Please try again."); }
    finally { setBusyId(null); }
  }
  if (!files.length) return <Empty><EmptyHeader><EmptyTitle>No files yet.</EmptyTitle><EmptyDescription>{canUpload ? "Upload your first file above." : "Files uploaded by workspace members will appear here."}</EmptyDescription></EmptyHeader></Empty>;
  return <div className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Table>
      <TableCaption>Latest 100 workspace files. Only ready files can be downloaded.</TableCaption>
      <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Size</TableHead><TableHead>Visibility</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{files.map((file) => <TableRow key={file.id}>
        <TableCell className="max-w-56 break-words whitespace-normal font-medium">{file.name}</TableCell>
        <TableCell>{(file.size / 1024).toFixed(1)} KiB</TableCell><TableCell>{file.visibility}</TableCell>
        <TableCell><Badge variant={file.status === "quarantined" ? "destructive" : "secondary"}>{file.status}</Badge></TableCell>
        <TableCell className="text-right">
          {file.status === "ready" && <Button variant="outline" size="sm" disabled={busyId === file.id} onClick={() => void act(file, "download")} aria-label={`Download ${file.name}`}>Download</Button>}
          {file.publicUrl && <Button asChild variant="outline" size="sm"><a href={file.publicUrl} aria-label={`Public link for ${file.name}`}>Public link</a></Button>}
          {file.status === "uploaded" && file.canConfirm && canUpload && <Button variant="outline" size="sm" disabled={busyId === file.id} onClick={() => void act(file, "confirm")}>Retry verification</Button>}
          {file.status === "quarantined" && <span className="text-xs text-muted-foreground">Unavailable</span>}
        </TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}
