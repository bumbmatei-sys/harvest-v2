"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations, useFormatter } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText } from "lucide-react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { defineStatusTones } from "@/lib/status-tone";
const fileTone = defineStatusTones({ ready: "success", uploaded: "pending", pending: "pending", quarantined: "danger" });
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
  if (!files.length) return <EmptyState icon={FileText} title={t("noFilesYet")} description={canUpload ? t("uploadYourFirstFileAbove") : t("filesUploadedByWorkspaceMembersWillAppearHere")} />;
  const columns: DataTableColumn[] = [
    { id: "file", header: t("file"), card: "title", className: "max-w-56 break-words whitespace-normal font-medium" },
    { id: "size", header: t("size") }, { id: "visibility", header: t("visibility") }, { id: "status", header: t("status") },
    { id: "actions", header: t("actions"), align: "end", card: "actions" },
  ];
  const rows: DataTableRow[] = files.map((file) => ({ id: file.id, label: file.name, cells: {
    file: file.name,
    size: t("fileSize", { size: format.number(file.size / 1024, "fileSize") }),
    visibility: t(`visibilityValues.${file.visibility}`),
    status: <StatusBadge tone={fileTone(file.status)} label={t(`statusValues.${file.status}`)} />,
    actions: <>
      {file.status === "ready" && <Button variant="outline" size="sm" disabled={busyId === file.id} onClick={() => void act(file, "download")} aria-label={t("downloadValue", { name: file.name })}>{t("download")}</Button>}
      {file.publicUrl && <Button asChild variant="outline" size="sm"><a href={file.publicUrl} aria-label={t("publicLinkForValue", { name: file.name })}>{t("publicLink")}</a></Button>}
      {file.status === "uploaded" && file.canConfirm && canUpload && <Button variant="outline" size="sm" disabled={busyId === file.id} onClick={() => void act(file, "confirm")}>{t("retryVerification")}</Button>}
      {file.status === "quarantined" && <span className="text-xs text-muted-foreground">{t("unavailable")}</span>}
    </>,
  } }));
  return <div className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <DataTable label={t("file")} note={t("latest100WorkspaceFilesOnlyReadyFilesCan")} columns={columns} rows={rows} bordered={false} />
  </div>;
}
