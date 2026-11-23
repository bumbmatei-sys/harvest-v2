"use client";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { buttonRadii, buttonStyles, fontIds, httpsUrl, type BrandKit } from "@/lib/email/blocks";

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>
    <div className="flex items-center gap-2"><input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-1" />
      <Input className="min-h-11 font-mono" aria-label={label} value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} /></div></div>;
}

/** The ministry brand kit: logo, colours, font, button style and mailing address. Changes update this email at once; Save keeps them as the ministry default. */
export function DesignPanel({ brand, onChange, onSave, saving }: { brand: BrandKit; onChange: (patch: Partial<BrandKit>, key?: string) => void; onSave: () => void; saving: boolean }) {
  const t = useTranslations("NewsletterCampaigns.design"), invalidText = useTranslations("NewsletterCampaigns.fields")("invalidLink"), uid = useId();
  const logoInvalid = brand.logoUrl !== "" && !httpsUrl(brand.logoUrl);
  const hexOk = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
  const color = (key: "primary" | "accent" | "canvas", label: string) => <ColorField key={key} id={`${uid}-${key}`} label={label} value={brand[key]} onChange={(v) => { if (hexOk(v) || v.length < 7) onChange({ [key]: v } as Partial<BrandKit>, key); }} />;
  return <div className="space-y-4" data-design-panel>
    <div className="space-y-2"><Label htmlFor={`${uid}-logo`}>{t("logo")}</Label>
      <Input id={`${uid}-logo`} className="min-h-11" inputMode="url" aria-invalid={logoInvalid || undefined} value={brand.logoUrl} onChange={(e) => onChange({ logoUrl: e.target.value }, "logo")} />
      {logoInvalid && <p className="text-sm text-destructive">{invalidText}</p>}</div>
    <div className="grid gap-4 sm:grid-cols-3">{color("primary", t("primary"))}{color("accent", t("accent"))}{color("canvas", t("canvas"))}</div>
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="space-y-2"><Label htmlFor={`${uid}-font`}>{t("font")}</Label><NativeSelect id={`${uid}-font`} className="w-full" value={brand.font} onChange={(e) => onChange({ font: e.target.value as BrandKit["font"] })}>{fontIds.map((f) => <NativeSelectOption key={f} value={f}>{t(`fonts.${f}`)}</NativeSelectOption>)}</NativeSelect></div>
      <div className="space-y-2"><Label htmlFor={`${uid}-style`}>{t("buttonStyle")}</Label><NativeSelect id={`${uid}-style`} className="w-full" value={brand.buttonStyle} onChange={(e) => onChange({ buttonStyle: e.target.value as BrandKit["buttonStyle"] })}>{buttonStyles.map((s) => <NativeSelectOption key={s} value={s}>{t(s)}</NativeSelectOption>)}</NativeSelect></div>
      <div className="space-y-2"><Label htmlFor={`${uid}-radius`}>{t("buttonRadius")}</Label><NativeSelect id={`${uid}-radius`} className="w-full" value={brand.buttonRadius} onChange={(e) => onChange({ buttonRadius: e.target.value as BrandKit["buttonRadius"] })}>{buttonRadii.map((r) => <NativeSelectOption key={r} value={r}>{t(r)}</NativeSelectOption>)}</NativeSelect></div>
    </div>
    <div className="space-y-2"><Label htmlFor={`${uid}-address`}>{t("address")}</Label>
      <textarea id={`${uid}-address`} rows={2} maxLength={300} value={brand.address} onChange={(e) => onChange({ address: e.target.value }, "address")} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div>
    <Button type="button" className="min-h-11" disabled={saving} onClick={onSave}>{t("save")}</Button>
  </div>;
}
