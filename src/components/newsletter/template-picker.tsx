"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmailThumbnail } from "@/components/newsletter/email-preview";
import { blankDocument, templateDocument, templateIds, type TemplateId } from "@/lib/email/templates";
import type { BrandKit } from "@/lib/email/blocks";

/** Thumbnails are the real templates rendered with the ministry's brand kit, so changing the kit changes every card. */
export function TemplatePicker({ brand, ministryName, onPick, busy = false }: { brand: BrandKit; ministryName: string; onPick: (id: TemplateId | "blank") => void; busy?: boolean }) {
  const t = useTranslations("NewsletterCampaigns");
  const items: { id: TemplateId | "blank"; name: string; description: string }[] = [{ id: "blank", name: t("blank"), description: t("blankHint") },
    ...templateIds.map((id) => ({ id, name: t(`templates.${id}.name`), description: t(`templates.${id}.description`) }))];
  return <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-template-picker>
    {items.map((item) => <li key={item.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3" data-template={item.id}>
      <EmailThumbnail doc={item.id === "blank" ? blankDocument(brand) : templateDocument(item.id, brand)} ministryName={ministryName} title={item.name} />
      <div className="min-w-0 flex-1"><p className="font-medium">{item.name}</p><p className="text-sm text-muted-foreground">{item.description}</p></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} aria-label={t("useTemplate", { name: item.name })} onClick={() => onPick(item.id)}>{t("useTemplate", { name: item.name })}</Button>
    </li>)}
  </ul>;
}
