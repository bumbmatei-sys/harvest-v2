"use client";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UploadControl } from "@/components/files/upload-control";

/** Upload to Harvest only: the existing upload path and scan rules, unchanged, in a dialog. Nothing is ever uploaded to a connected drive. */
export function UploadDialog({ tenantId, canUpload }: { tenantId: string; canUpload: boolean }) {
  const t = useTranslations("FilesScreen.upload");
  return <Dialog>
    <DialogTrigger asChild><Button type="button" size="responsive" data-testid="upload-open"><Upload aria-hidden="true" />{t("open")}</Button></DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("subtitle")}</DialogDescription></DialogHeader>
      <UploadControl tenantId={tenantId} canUpload={canUpload} />
    </DialogContent>
  </Dialog>;
}
