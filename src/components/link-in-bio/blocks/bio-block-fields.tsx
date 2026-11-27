"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseVideoLink, videoLink } from "@/lib/lesson-video";
import { bioLimits, newBlockId, type BioBlock } from "@/lib/link-in-bio";
import type { BioChoices } from "@/server/link-in-bio";

type NewBlock = Extract<BioBlock, { type: "catalog" | "files" | "form" | "video" | "contact" | "location" | "live" | "testimonials" }>;

/** The editor fields of the block types added by the link in bio rework (PR 2). The older types keep their fields in the editor itself. */
export function BioBlockFields({ block, patch, choices, issue }: { block: NewBlock; patch: (change: Record<string, unknown>) => void; choices: BioChoices; issue?: "url" | "required" }) {
  const t = useTranslations("LinkInBio.blocks");
  const [videoText, setVideoText] = useState(() => block.type === "video" && block.videoId ? videoLink({ provider: block.provider, id: block.videoId }) : "");
  const id = (name: string) => `${name}-${block.id}`;
  switch (block.type) {
    case "catalog": case "files": {
      const options = (choices.catalog ?? []).filter((item) => block.type === "catalog" || item.kind === "download");
      const toggle = (itemId: string, on: boolean) => patch({ itemIds: on ? [...block.itemIds, itemId] : block.itemIds.filter((x) => x !== itemId) });
      const max = block.type === "catalog" ? bioLimits.catalogItems : bioLimits.fileItems;
      return <>
        <Field><FieldLabel htmlFor={id("ct")}>{t("sectionTitle")}</FieldLabel>
          <Input id={id("ct")} className="min-h-11" maxLength={bioLimits.messageTitle} value={block.title} onChange={(e) => patch({ title: e.target.value })} /></Field>
        <fieldset className="space-y-1 sm:col-span-2" data-invalid={issue ? true : undefined}><legend className="text-sm font-medium">{t("items")}</legend>
          {options.length === 0 ? <p className="text-sm text-muted-foreground">{t(block.type === "catalog" ? "noCatalog" : "noDownloads")}</p>
            : options.map((item) => { const checked = block.itemIds.includes(item.id), off = item.state !== "published" || item.visibility === "hidden";
              return <Label key={item.id} htmlFor={id(`ci-${item.id}`)} className="flex min-h-11 items-center gap-3 font-normal">
                <Checkbox id={id(`ci-${item.id}`)} checked={checked} disabled={!checked && block.itemIds.length >= max} onCheckedChange={(on) => toggle(item.id, on === true)} />
                <span className="min-w-0 flex-1 break-words">{item.title}{off && <span className="block text-xs text-muted-foreground">{t("itemDraft")}</span>}</span></Label>; })}
          <p className="text-xs text-muted-foreground">{t("maxItems", { max })}</p></fieldset>
      </>;
    }
    case "form": return <>
      <Field><FieldLabel htmlFor={id("ft")}>{t("buttonText")}</FieldLabel>
        <Input id={id("ft")} className="min-h-11" maxLength={bioLimits.messageTitle} value={block.title} aria-invalid={issue === "required" || undefined} onChange={(e) => patch({ title: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor={id("fs")}>{t("formPick")}</FieldLabel>
        <NativeSelect id={id("fs")} className="min-h-11 w-full" value={block.slug} onChange={(e) => patch({ slug: e.target.value })}>
          {!(choices.forms ?? []).some((f) => f.slug === block.slug) && <option value={block.slug}>{block.slug}</option>}
          {(choices.forms ?? []).map((f) => <option key={f.slug} value={f.slug}>{f.title}</option>)}</NativeSelect></Field>
    </>;
    case "video": return <>
      <Field data-invalid={issue === "url" || undefined} className="sm:col-span-2"><FieldLabel htmlFor={id("vu")}>{t("videoUrl")}</FieldLabel>
        <Input id={id("vu")} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={videoText} aria-invalid={issue === "url" || undefined}
          onChange={(e) => { setVideoText(e.target.value); const parsed = parseVideoLink(e.target.value); patch(parsed ? { provider: parsed.provider, videoId: parsed.id } : { videoId: "" }); }} />
        {issue === "url" && <FieldError>{t("videoProblem")}</FieldError>}</Field>
      <Field className="sm:col-span-2"><FieldLabel htmlFor={id("vt")}>{t("videoTitle")}</FieldLabel>
        <Input id={id("vt")} className="min-h-11" maxLength={bioLimits.videoTitle} value={block.title} onChange={(e) => patch({ title: e.target.value })} /></Field>
    </>;
    case "contact": return <>
      <Field><FieldLabel htmlFor={id("ce")}>{t("email")}</FieldLabel>
        <Input id={id("ce")} type="email" inputMode="email" className="min-h-11" maxLength={254} value={block.email} aria-invalid={Boolean(issue) || undefined} onChange={(e) => patch({ email: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor={id("cp")}>{t("phone")}</FieldLabel>
        <Input id={id("cp")} type="tel" inputMode="tel" className="min-h-11" maxLength={bioLimits.phone} value={block.phone} aria-invalid={Boolean(issue) || undefined} onChange={(e) => patch({ phone: e.target.value })} /></Field>
      <Field data-invalid={issue ? true : undefined}><FieldLabel htmlFor={id("cw")}>{t("whatsapp")}</FieldLabel>
        <Input id={id("cw")} type="tel" inputMode="tel" className="min-h-11" maxLength={bioLimits.phone} value={block.whatsapp} aria-invalid={Boolean(issue) || undefined} onChange={(e) => patch({ whatsapp: e.target.value })} />
        {issue && <FieldError>{t("contactProblem")}</FieldError>}</Field>
    </>;
    case "location": return <>
      <Field><FieldLabel htmlFor={id("ln")}>{t("locationName")}</FieldLabel>
        <Input id={id("ln")} className="min-h-11" maxLength={bioLimits.label} value={block.label} onChange={(e) => patch({ label: e.target.value })} /></Field>
      <Field data-invalid={issue ? true : undefined} className="sm:col-span-2"><FieldLabel htmlFor={id("la")}>{t("address")}</FieldLabel>
        <Textarea id={id("la")} rows={2} maxLength={bioLimits.address} value={block.address} aria-invalid={Boolean(issue) || undefined} onChange={(e) => patch({ address: e.target.value })} />
        {issue && <FieldError>{t("addressProblem")}</FieldError>}</Field>
    </>;
    case "live": return <>
      <Label htmlFor={id("lo")} className="flex min-h-11 items-center gap-3 font-normal sm:col-span-2"><Switch id={id("lo")} checked={block.on} onCheckedChange={(on) => patch({ on })} />{t("liveOn")}
        <span className="text-xs text-muted-foreground">{t("liveOff")}</span></Label>
      <Field data-invalid={issue === "required" || undefined}><FieldLabel htmlFor={id("lt")}>{t("liveTitle")}</FieldLabel>
        <Input id={id("lt")} className="min-h-11" maxLength={bioLimits.label} value={block.title} aria-invalid={issue === "required" || undefined} onChange={(e) => patch({ title: e.target.value })} /></Field>
      <Field data-invalid={issue === "url" || undefined}><FieldLabel htmlFor={id("lu")}>{t("liveUrl")}</FieldLabel>
        <Input id={id("lu")} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={block.url} aria-invalid={issue === "url" || undefined} onChange={(e) => patch({ url: e.target.value })} /></Field>
    </>;
    case "testimonials": {
      const items = block.items, set = (next: typeof items) => patch({ items: next });
      return <div className="space-y-3 sm:col-span-2" data-bio-testimonials-editor>
        {items.map((item, index) => <div key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <Field className="sm:col-span-2" data-invalid={issue && !item.quote.trim() ? true : undefined}><FieldLabel htmlFor={id(`tq-${item.id}`)}>{t("quote")}</FieldLabel>
            <Textarea id={id(`tq-${item.id}`)} rows={3} maxLength={bioLimits.quote} value={item.quote} onChange={(e) => set(items.map((x) => x.id === item.id ? { ...x, quote: e.target.value } : x))} /></Field>
          <Field data-invalid={issue && !item.name.trim() ? true : undefined}><FieldLabel htmlFor={id(`tn-${item.id}`)}>{t("person")}</FieldLabel>
            <Input id={id(`tn-${item.id}`)} className="min-h-11" maxLength={bioLimits.personName} value={item.name} onChange={(e) => set(items.map((x) => x.id === item.id ? { ...x, name: e.target.value } : x))} /></Field>
          <Field><FieldLabel htmlFor={id(`tr-${item.id}`)}>{t("role")}</FieldLabel>
            <Input id={id(`tr-${item.id}`)} className="min-h-11" maxLength={bioLimits.personName} value={item.role} onChange={(e) => set(items.map((x) => x.id === item.id ? { ...x, role: e.target.value } : x))} /></Field>
          <div className="sm:col-span-2"><Button type="button" variant="ghost" className="min-h-11" disabled={items.length <= 1} onClick={() => set(items.filter((x) => x.id !== item.id))}>
            <Trash2 aria-hidden="true" />{t("removeTestimonial", { position: index + 1 })}</Button></div>
        </div>)}
        {issue && <p className="text-sm text-destructive">{t("testimonialProblem")}</p>}
        <Button type="button" variant="outline" className="min-h-11" disabled={items.length >= bioLimits.testimonials} onClick={() => set([...items, { id: newBlockId(items.map((x) => x.id)), quote: "", name: "", role: "" }])}>
          <Plus aria-hidden="true" />{t("addTestimonial")}</Button>
      </div>;
    }
  }
}
