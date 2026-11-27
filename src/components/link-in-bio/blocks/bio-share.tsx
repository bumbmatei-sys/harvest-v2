/** Derived from Shadcn UI Kit item dashboard-modal2 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/copy-button";

/**
 * Share: a button that opens a dialog with the page address (read-only field and a copy button), the device's own share sheet where there is one, and
 * the page's QR code from the server's renderer with a PNG download. Nothing leaves the page unless the visitor shares it.
 */
export function BioShare({ title, handle, preview, shareUrl }: { title: string; handle: string; preview: boolean; shareUrl: string }) {
  const t = useTranslations("LinkInBio.public");
  const [address, setAddress] = useState(""), [canShare, setCanShare] = useState(false);
  const qr = `/l/${encodeURIComponent(handle)}/qr`;
  // The configured page address comes from the server; the share sheet is read when the dialog opens (it exists only in the browser).
  const opened = (open: boolean) => { if (open) { setAddress(shareUrl); setCanShare(typeof navigator.share === "function"); } };
  return <Dialog onOpenChange={opened}>
    <DialogTrigger asChild><Button type="button" variant="outline" className="min-h-11 w-full" tabIndex={preview ? -1 : undefined} disabled={preview} data-bio-share><Share2 aria-hidden="true" />{title}</Button></DialogTrigger>
    {!preview && <DialogContent className="sm:max-w-md" data-bio-share-dialog>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t("shareHint")}</DialogDescription></DialogHeader>
      <Field><FieldLabel htmlFor="bio-share-link" className="sr-only">{t("shareLink")}</FieldLabel>
        <div className="flex items-center gap-2"><Input id="bio-share-link" readOnly value={address} className="min-h-11" onFocus={(event) => event.currentTarget.select()} /><CopyButton value={address} label={t("shareCopy")} /></div></Field>
      {canShare && <Button type="button" variant="outline" className="min-h-11" onClick={() => { void navigator.share({ url: address, title }).catch(() => undefined); }}><Share2 aria-hidden="true" />{t("shareDevice")}</Button>}
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a server-drawn SVG of the page address */}
        <img src={qr} alt={t("qrAlt")} className="size-48 rounded-md border bg-card p-2" data-bio-share-qr />
        <Button asChild variant="outline" className="min-h-11"><a href={`${qr}?format=png&download=1`} download><Download aria-hidden="true" />{t("qrDownload")}</a></Button>
      </div>
    </DialogContent>}
  </Dialog>;
}
