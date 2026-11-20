"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { DestinationPreview } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";
import { RingMark } from "@/components/social/platform-ring";

/**
 * The review step before Publish now: every destination with the exact text that will be sent and how many files go with it. Nothing is sent
 * until the person confirms here; the confirm button carries the consequence ("Publish to 3 accounts"). The review expires on the server.
 */
export function ReviewDialog({ open, onOpenChange, destinations, expiresAt, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; destinations: readonly DestinationPreview[]; expiresAt?: string; onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("SocialPublish.review"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function confirm() {
    setBusy(true); setError("");
    try { await onConfirm(); onOpenChange(false); } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("failed")); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" data-testid="review-dialog">
      <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("lead", { count: destinations.length })}</DialogDescription></DialogHeader>
      <ul className="m-0 list-none space-y-2 p-0">
        {destinations.map((destination) => <li key={destination.account.id} className="space-y-1 rounded-lg border p-3" data-testid="review-destination">
          <div className="flex items-center gap-2"><RingMark platform={destination.account.platform} active={false} size={28} className="[&>span]:size-5 [&>span]:text-[9px]" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{platformLabels[destination.account.platform]} <span className="font-normal text-muted-foreground">{destination.account.displayName}</span></span>
            <span className="text-xs text-muted-foreground">{t("files", { count: destination.attachments.length })}</span></div>
          <p className="whitespace-pre-wrap break-words text-sm">{destination.content || t("noText")}</p>
          {destination.options?.tiktok && <p className="text-xs text-muted-foreground" data-testid="review-tiktok">{t("tiktok", { privacy: t(`privacy.${destination.options.tiktok.privacy}`) })}</p>}
          {destination.options?.firstComment && <p className="text-xs text-muted-foreground">{t("firstComment", { text: destination.options.firstComment })}</p>}
        </li>)}
      </ul>
      {expiresAt && <p className="text-xs text-muted-foreground">{t("expires", { time: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(expiresAt)) })}</p>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => onOpenChange(false)}>{t("back")}</Button>
        <Button type="button" size="responsive" aria-disabled={busy || undefined} onClick={() => void confirm()}>{busy ? <Spinner /> : <Send aria-hidden="true" />}{t("confirm", { count: destinations.length })}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
