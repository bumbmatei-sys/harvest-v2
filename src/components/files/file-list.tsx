"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations, useFormatter } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableCaption } from "@/components/ui/table";
type FileRow = { id: string; name: string; size: number; status: string; visibility: string; canConfirm: boolean; publicUrl: string | null };
export function FileList({ files, tenantId, canUpload }: { files: FileRow[]; tenantId: string; canUpload: boolean }) {
  const t = useTranslations("ComponentsFilesFileList");
  const format = useFormatter();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  async function act(file: FileRow, action: "download" | "confirm") {
    setBusyId(file.id); setError("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/files/${file.id}/${action}`, { method: action === "confirm" ? "POST" : "GET" });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data.error));
      if (action === "download") window.location.assign(data.url);
      else router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : t("couldNotOpenFilePleaseTryAgain")); }
    finally { setBusyId(null); }
  }
  if (!files.length) return <Empty><EmptyHeader><EmptyTitle>{t("noFilesYet")}</EmptyTitle><EmptyDescription>{canUpload ? t("uploadYourFirstFileAbove") : t("filesUploadedByWorkspaceMembersWillAppearHere")}</EmptyDescription></EmptyHeader></Empty>;
  return <div className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Table>
      <TableCaption>{t("latest100WorkspaceFilesOnlyReadyFilesCan")}</TableCaption>
      <TableHeader><TableRow><TableHead>{t("file")}</TableHead><TableHead>{t("size")}</TableHead><TableHead>{t("visibility")}</TableHead><TableHead>{t("status")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader>
      <TableBody>{files.map((file) => <TableRow key={file.id}>
        <TableCell className="max-w-56 break-words whitespace-normal font-medium">{file.name}</TableCell>
        <TableCell>{t("fileSize", { size: format.number(file.size / 1024, "fileSize") })}</TableCell><TableCell>{t(`visibilityValues.${file.visibility}`)}</TableCell>
        <TableCell><Badge variant={file.status === "quarantined" ? "destructive" : "secondary"}>{t(`statusValues.${file.status}`)}</Badge></TableCell>
        <TableCell className="text-right">
          {file.status === "ready" && <Button variant="outline" size="sm" disabled={busyId === file.id} onClick={() => void act(file, "download")} aria-label={t("downloadValue", { name: file.name })}>{t("download")}</Button>}
          {file.publicUrl && <Button asChild variant="outline" size="sm"><a href={file.publicUrl} aria-label={t("publicLinkForValue", { name: file.name })}>{t("publicLink")}</a></Button>}
          {file.status === "uploaded" && file.canConfirm && canUpload && <Button variant="outline" size="sm" disabled={busyId === file.id} onClick={() => void act(file, "confirm")}>{t("retryVerification")}</Button>}
          {file.status === "quarantined" && <span className="text-xs text-muted-foreground">{t("unavailable")}</span>}
        </TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </div>;
}
