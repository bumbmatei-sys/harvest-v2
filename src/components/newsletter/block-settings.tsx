"use client";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { ImagePicker } from "@/components/newsletter/image-picker";
import { httpsUrl, type EmailBlock } from "@/lib/email/blocks";

type Kind = "text" | "area" | "url" | "side" | "align" | "size" | "switch" | "picture";
type Field = [key: string, kind: Kind];
const fieldsByType: Record<EmailBlock["type"], Field[]> = {
  header: [["title", "text"], ["showLogo", "switch"], ["align", "align"]],
  hero: [["heading", "text"], ["text", "area"], ["buttonLabel", "text"], ["buttonUrl", "url"], ["imageUrl", "picture"]],
  text: [],
  imageText: [["heading", "text"], ["text", "area"], ["imageUrl", "picture"], ["side", "side"]],
  columns: [["leftHeading", "text"], ["leftText", "area"], ["rightHeading", "text"], ["rightText", "area"]],
  quote: [["text", "area"], ["cite", "text"]],
  event: [["title", "text"], ["date", "text"], ["time", "text"], ["location", "text"], ["buttonLabel", "text"], ["buttonUrl", "url"]],
  giving: [["heading", "text"], ["text", "area"], ["buttonLabel", "text"], ["buttonUrl", "url"]],
  video: [["videoUrl", "url"], ["thumbnailUrl", "picture"], ["caption", "text"]],
  image: [["imageUrl", "picture"], ["linkUrl", "url"]],
  social: [], divider: [], spacer: [["size", "size"]], footer: [["note", "area"]],
};
const merge = ["{{firstName}}", "{{ministryName}}"];

/** Settings for the selected block: a small descriptor table drives every block type, so there is one form, not thirteen. */
export function BlockSettings({ block, onChange, tenantId, suggestions }: { block: EmailBlock; onChange: (patch: Record<string, unknown>, key?: string) => void; tenantId: string; suggestions: boolean }) {
  const t = useTranslations("NewsletterCampaigns.fields"), e = useTranslations("NewsletterCampaigns.editor"), uid = useId();
  const record = block as unknown as Record<string, unknown>;
  const fields = fieldsByType[block.type];
  const insert = (key: string, token: string) => onChange({ [key]: String(record[key] ?? "") + token }, `${block.id}-${key}`);
  const field = ([key, kind]: Field) => {
    const id = `${uid}-${key}`, value = record[key];
    if (kind === "picture") return <ImagePicker key={key} tenantId={tenantId} id={id} label={t(block.type === "video" ? "thumbnail" : "imageUrl")} urlKey={key} url={String(value ?? "")}
      fileId={record.fileId as string | undefined} alt={String(record.alt ?? "")} decorative={record.decorative === true} onChange={(patch, k) => onChange(patch, k ? `${block.id}-${k}` : undefined)}
      videoUrl={block.type === "video" ? block.videoUrl : undefined} suggestions={suggestions} requireAlt={block.type === "image"} />;
    if (kind === "switch") return <Label key={key} htmlFor={id} className="flex min-h-11 items-center gap-3 font-normal"><Switch id={id} checked={value === true} onCheckedChange={(v) => onChange({ [key]: v })} />{t(key)}</Label>;
    if (kind === "side" || kind === "align" || kind === "size") {
      const options = kind === "side" ? ["left", "right"] : kind === "align" ? ["left", "center"] : ["small", "medium", "large"];
      const label = (o: string) => t(kind === "side" ? (o === "left" ? "sideLeft" : "sideRight") : kind === "align" ? (o === "left" ? "alignLeft" : "alignCenter") : o);
      return <div key={key} className="space-y-2"><Label htmlFor={id}>{t(key)}</Label>
        <NativeSelect id={id} className="w-full sm:w-64" value={String(value)} onChange={(ev) => onChange({ [key]: ev.target.value })}>{options.map((o) => <NativeSelectOption key={o} value={o}>{label(o)}</NativeSelectOption>)}</NativeSelect></div>;
    }
    const invalid = kind === "url" && typeof value === "string" && value !== "" && !httpsUrl(value);
    return <div key={key} className="space-y-2">
      <div className="flex items-center justify-between gap-2"><Label htmlFor={id}>{t(key)}</Label>
        {kind !== "url" && <span className="flex gap-1">{merge.map((token) => <Button key={token} type="button" variant="ghost" size="sm" className="min-h-11 text-xs" aria-label={e("insertField", { field: e(token === merge[0] ? "firstName" : "ministryName") })} onClick={() => insert(key, token)}>{e(token === merge[0] ? "firstName" : "ministryName")}</Button>)}</span>}</div>
      {kind === "area" ? <Textarea id={id} rows={3} maxLength={800} value={String(value ?? "")} onChange={(ev) => onChange({ [key]: ev.target.value }, `${block.id}-${key}`)} />
        : <Input id={id} className="min-h-11" inputMode={kind === "url" ? "url" : undefined} maxLength={kind === "url" ? 2000 : 200} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} value={String(value ?? "")} onChange={(ev) => onChange({ [key]: ev.target.value }, `${block.id}-${key}`)} />}
      {invalid && <p id={`${id}-error`} className="text-sm text-destructive">{t("invalidLink")}</p>}
    </div>;
  };
  return <div className="space-y-4 border-t p-4" data-block-editor>
    {block.type === "text" && <RichTextEditor label={t("richText")} value={block.doc} onChange={(doc) => onChange({ doc }, `${block.id}-doc`)} />}
    {block.type === "social" && <div className="space-y-3">{block.links.map((link, index) => {
      const invalid = link.url !== "" && !httpsUrl(link.url);
      return <div key={index} className="flex flex-wrap items-start gap-2">
        <Input className="min-h-11 w-32" aria-label={t("linkLabel", { number: index + 1 })} value={link.label} maxLength={40} onChange={(ev) => onChange({ links: block.links.map((l, i) => i === index ? { ...l, label: ev.target.value } : l) }, `${block.id}-l${index}`)} />
        <div className="min-w-40 flex-1"><Input className="min-h-11" inputMode="url" aria-label={t("linkUrl", { number: index + 1 })} aria-invalid={invalid || undefined} value={link.url} onChange={(ev) => onChange({ links: block.links.map((l, i) => i === index ? { ...l, url: ev.target.value } : l) }, `${block.id}-u${index}`)} />
          {invalid && <p className="mt-1 text-sm text-destructive">{t("invalidLink")}</p>}</div>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("removeLink", { number: index + 1 })} onClick={() => onChange({ links: block.links.filter((_, i) => i !== index) })}><X aria-hidden="true" /></Button></div>;
    })}{block.links.length < 6 && <Button type="button" variant="outline" className="min-h-11" onClick={() => onChange({ links: [...block.links, { label: "", url: "" }] })}><Plus aria-hidden="true" />{t("addLink")}</Button>}</div>}
    {fields.map(field)}
    {fields.length === 0 && block.type !== "text" && block.type !== "social" && <p className="text-sm text-muted-foreground">{t("none")}</p>}
  </div>;
}
