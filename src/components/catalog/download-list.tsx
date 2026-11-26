"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, FileText } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/empty-state";
import { useRequest } from "@/hooks/use-request";

/** The files of a download the learner may open. Each click asks the server for a fresh 60 second address after it checks the grant; nothing is cached here. */
export function DownloadList({ slug, files }: { slug: string; files: { id: string; name: string }[] }) {
  const t = useTranslations("CatalogPublic"), request = useRequest();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function open(id: string) {
    setBusy(id); setError("");
    const result = await request<{ url: string }>(`/api/catalog/${slug}/files/${id}`, { method: "GET" });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    window.location.assign(result.data.url);
  }
  if (files.length === 0) return <EmptyState icon={FileText} title={t("noFiles")} size="compact" />;
  return <div className="space-y-3">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <ul aria-label={t("files")} className="divide-y rounded-lg border bg-card">
      {files.map((file) => <li key={file.id} className="flex flex-wrap items-center gap-3 p-3">
        <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} aria-label={t("downloadNamed", { name: file.name })} onClick={() => void open(file.id)}>
          {busy === file.id ? <Spinner decorative size="sm" /> : <Download aria-hidden="true" />}{t("download")}</Button>
      </li>)}
    </ul>
  </div>;
}
