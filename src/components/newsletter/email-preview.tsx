"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { renderEmail } from "@/lib/email/render";
import { documentFileIds, type EmailDocument } from "@/lib/email/blocks";
import { publicFilePath } from "@/lib/files";
import { cn } from "@/lib/utils";

const sample = { unsubscribe: "https://newsletter.example.test/unsubscribe" };

/** The rendered email in a sandboxed frame (no scripts, no network access to the app). Desktop and mobile widths. */
export function EmailPreview({ tenantId, doc, preheader, ministryName, firstName }: { tenantId: string; doc: EmailDocument; preheader?: string | null; ministryName: string; firstName: string }) {
  const t = useTranslations("NewsletterCampaigns.editor");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const html = useMemo(() => renderEmail(doc, { ...sample, preheader, ministryName, firstName, preview: true,
    images: new Map(documentFileIds(doc).map((id) => [id, publicFilePath(tenantId, id)])) }).html, [doc, preheader, ministryName, firstName, tenantId]);
  return <div className="space-y-3" data-email-preview>
    <div role="group" aria-label={t("previewTitle")} className="flex gap-1">
      {(["desktop", "mobile"] as const).map((id) => <Button key={id} type="button" variant={device === id ? "secondary" : "ghost"} className="min-h-11" aria-pressed={device === id} onClick={() => setDevice(id)}>
        {id === "desktop" ? <Monitor aria-hidden="true" /> : <Smartphone aria-hidden="true" />}{t(id)}</Button>)}
    </div>
    <div className="overflow-hidden rounded-xl border bg-muted/30">
      <iframe title={t("previewTitle")} sandbox="" srcDoc={html} data-device={device} className={cn("mx-auto block h-[640px] max-w-full border-0 bg-card", device === "mobile" ? "w-[375px]" : "w-[640px]")} />
    </div>
  </div>;
}

/** A small, non-interactive rendering of a document for pickers (scaled; no static images). */
export function EmailThumbnail({ doc, ministryName, title }: { doc: EmailDocument; ministryName: string; title: string }) {
  const html = useMemo(() => renderEmail(doc, { ...sample, ministryName, firstName: "Ana" }).html, [doc, ministryName]);
  return <div className="relative h-44 w-full overflow-hidden rounded-lg border bg-card" aria-hidden="true">
    <iframe title={title} sandbox="" srcDoc={html} tabIndex={-1} loading="lazy" className="pointer-events-none absolute left-0 top-0 h-[880px] w-[640px] origin-top-left border-0" style={{ transform: "scale(0.4)" }} />
  </div>;
}
