/** Derived from Shadcn UI Kit item form-layout14 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/form-section";
import { EventCoverPicker, type CoverChange } from "@/components/events/event-cover-picker";
import { NetworkMark } from "@/components/link-in-bio/bio-icons";
import { bioIconStyles, bioLimits, bioNetworks, bioPhotoAligns, type BioDefinition } from "@/lib/link-in-bio";

/** A label-left row (stacked on a phone): the name of the setting, then its control. */
function ProfileRow({ title, htmlFor, children }: { title: string; htmlFor?: string; children: ReactNode }) {
  return <div className="grid gap-3 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8">
    <FieldContent>{htmlFor ? <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel> : <FieldTitle>{title}</FieldTitle>}</FieldContent>
    <div className="flex min-w-0 flex-col gap-3">{children}</div>
  </div>;
}

type Picture = { fileId: string | null; url: string | null; failed: () => void; onChange: (change: CoverChange) => void };

/**
 * The Profile step of the link in bio editor: cover on or off with a small square upload, the required profile photo and its position, name, subtitle and
 * short bio, then the social and website icons in one style for the whole page. Uploads take effect at once (their own requests); text is saved with the draft.
 */
export function BioProfileStep({ definition, setDefinition, endpoint, version, cover, photo, onBusyChange, touched, issues }: {
  definition: BioDefinition; setDefinition: (patch: Partial<BioDefinition>) => void; endpoint: string; version: number; cover: Picture; photo: Picture;
  onBusyChange: (busy: boolean) => void; touched: boolean; issues: Record<string, string>;
}) {
  const t = useTranslations("LinkInBio");
  const nameMissing = touched && !definition.name.trim(), photoMissing = touched && !photo.fileId;
  const taken = definition.socials.map((s) => s.network);
  const updateSocial = (index: number, patch: Partial<BioDefinition["socials"][number]>) => setDefinition({ socials: definition.socials.map((s, i) => i === index ? { ...s, ...patch } : s) });
  return <>
    <FormSection title={<span className="sr-only">{t("steps.profile")}</span>}>
      <div className="divide-y" data-bio-profile>
        <ProfileRow title={t("profile.cover")}>
          <Label htmlFor="bio-cover-on" className="flex min-h-11 items-center gap-3 font-normal"><Switch id="bio-cover-on" checked={definition.cover} onCheckedChange={(on) => setDefinition({ cover: on })} />{t("profile.coverShow")}</Label>
          {definition.cover && <EventCoverPicker variant="square" namespace="LinkInBio.banner" endpoint={`${endpoint}/banner`} saved coverFileId={cover.fileId} version={version} url={cover.url} onUrlFailed={cover.failed} onChange={cover.onChange} onBusyChange={onBusyChange} />}
        </ProfileRow>
        <ProfileRow title={t("profile.photoRow")}>
          <EventCoverPicker variant="square" invalid={photoMissing} namespace="LinkInBio.cover" endpoint={`${endpoint}/photo`} saved coverFileId={photo.fileId} version={version} url={photo.url} onUrlFailed={photo.failed} onChange={photo.onChange} onBusyChange={onBusyChange} />
          {photoMissing && <p className="text-sm text-destructive" role="alert">{t("publishing.checkPhoto")}</p>}
          <RadioGroup value={definition.photoAlign} onValueChange={(value) => setDefinition({ photoAlign: value as BioDefinition["photoAlign"] })} className="grid grid-cols-2 gap-2" aria-label={t("profile.photoAlign")}>
            {bioPhotoAligns.map((value) => <Label key={value} htmlFor={`bio-align-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
              <RadioGroupItem id={`bio-align-${value}`} value={value} />{t(`profile.aligns.${value}`)}</Label>)}
          </RadioGroup>
        </ProfileRow>
        <ProfileRow title={t("profile.name")} htmlFor="bio-name">
          <Field data-invalid={nameMissing || undefined}>
            <Input id="bio-name" className="min-h-11" maxLength={bioLimits.name} value={definition.name} aria-invalid={nameMissing || undefined} onChange={(e) => setDefinition({ name: e.target.value })} />
            {nameMissing && <FieldError>{t("publishing.checkName")}</FieldError>}</Field>
        </ProfileRow>
        <ProfileRow title={t("profile.subtitle")} htmlFor="bio-subtitle">
          <Input id="bio-subtitle" className="min-h-11" maxLength={bioLimits.subtitle} value={definition.subtitle} onChange={(e) => setDefinition({ subtitle: e.target.value })} />
        </ProfileRow>
        <ProfileRow title={t("profile.bio")} htmlFor="bio-bio">
          <Textarea id="bio-bio" rows={4} maxLength={bioLimits.bio} value={definition.bio} onChange={(e) => setDefinition({ bio: e.target.value })} />
          <p className="text-xs text-muted-foreground" aria-live="polite">{t("profile.bioCount", { count: definition.bio.length, max: bioLimits.bio })}</p>
        </ProfileRow>
      </div>
    </FormSection>
    <FormSection title={<span className="text-base font-semibold">{t("links.socials")}</span>}>
      <RadioGroup value={definition.iconStyle} onValueChange={(value) => setDefinition({ iconStyle: value as BioDefinition["iconStyle"] })} className="grid grid-cols-2 gap-2" aria-label={t("profile.iconStyle")}>
        {bioIconStyles.map((value) => <Label key={value} htmlFor={`bio-icons-${value}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 font-normal">
          <RadioGroupItem id={`bio-icons-${value}`} value={value} /><NetworkMark network="instagram" colored={value === "color"} />{t(`profile.iconStyles.${value}`)}</Label>)}
      </RadioGroup>
      <ul className="space-y-3">{definition.socials.map((social, index) => { const bad = touched && issues[`social:${social.network}`]; return <li key={social.network} className="grid items-end gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]" data-bio-social={social.network}>
        <Field><FieldLabel htmlFor={`sn-${index}`}>{t("links.network")}</FieldLabel>
          <NativeSelect id={`sn-${index}`} className="min-h-11 w-full" value={social.network} onChange={(e) => updateSocial(index, { network: e.target.value as typeof social.network })}>
            {bioNetworks.filter((n) => n === social.network || !taken.includes(n)).map((n) => <option key={n} value={n}>{t(`networks.${n}`)}</option>)}</NativeSelect></Field>
        <Field data-invalid={bad ? true : undefined}><FieldLabel htmlFor={`su-${index}`}>{t("links.socialUrl")}</FieldLabel>
          <Input id={`su-${index}`} type="url" inputMode="url" className="min-h-11" maxLength={bioLimits.url} value={social.url} aria-invalid={bad ? true : undefined} onChange={(e) => updateSocial(index, { url: e.target.value })} />
          {bad && <FieldError>{t("links.urlProblem")}</FieldError>}</Field>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("links.removeSocial", { network: t(`networks.${social.network}`) })} onClick={() => setDefinition({ socials: definition.socials.filter((_, i) => i !== index) })}><Trash2 aria-hidden="true" /></Button>
      </li>; })}</ul>
      <div><Button type="button" variant="outline" className="min-h-11" disabled={definition.socials.length >= bioLimits.socials} onClick={() => { const next = bioNetworks.find((n) => !taken.includes(n)); if (next) setDefinition({ socials: [...definition.socials, { network: next, url: "https://" }] }); }}><Plus aria-hidden="true" />{t("links.addSocial")}</Button></div>
    </FormSection>
  </>;
}
