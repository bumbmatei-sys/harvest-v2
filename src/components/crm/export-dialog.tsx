"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCrmRequest } from "./request";

type Count = { total: number; notes: boolean; sources?: boolean; max: number };

/**
 * Export the current view. The count and the file use the same URL view state as the list,
 * and the server applies the list's own SQL predicate, so the three always agree.
 */
export function ExportDialog({ tenantId, entity, query, listName }: { tenantId: string; entity: "person" | "company"; query: string; listName: string }) {
  const t = useTranslations("Exports");
  const format = useFormatter();
  const crmRequest = useCrmRequest();
  const [count, setCount] = useState<Count | null>(null), [error, setError] = useState("");
  const params = `entity=${entity}${query ? `&${query}` : ""}`;
  async function open(value: boolean) {
    if (!value) return;
    setCount(null); setError("");
    const result = await crmRequest<Count>(`/api/workspaces/${tenantId}/crm/export/count?${params}`, { method: "GET" });
    if (result.ok) setCount(result.data); else setError(result.error);
  }
  const tooMany = !!count && count.total > count.max;
  return <Dialog onOpenChange={(value) => void open(value)}>
    <DialogTrigger asChild><Button size="responsive" variant="outline"><Download aria-hidden="true" />{t("export")}</Button></DialogTrigger>
    <DialogContent className="rounded-xl sm:max-w-[480px]">
      <DialogHeader><DialogTitle>{t("exportTitle", { list: listName })}</DialogTitle><DialogDescription>{t("exportDescription")}</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm" aria-live="polite">
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          : !count ? <p className="text-muted-foreground">{t("counting")}</p>
            : <>
              <p className="font-medium">{tooMany ? t("tooMany", { max: format.number(count.max) }) : t("count", { count: count.total })}</p>
              {entity === "person" && <p className="text-muted-foreground">{count.notes ? t("notesIncluded") : t("notesExcluded")}</p>}
              {count.sources && <p className="text-muted-foreground">{t("sourcesIncluded")}</p>}
              <p className="text-muted-foreground">{t("safety")}</p>
            </>}
      </div>
      <DialogFooter>
        <DialogClose asChild><Button className="min-h-11" variant="ghost">{t("close")}</Button></DialogClose>
        {count && !tooMany && count.total > 0
          ? <Button className="min-h-11" asChild><a href={`/api/workspaces/${tenantId}/crm/export?${params}`} download><Download aria-hidden="true" />{t("download")}</a></Button>
          : <Button className="min-h-11" disabled><Download aria-hidden="true" />{t("download")}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
