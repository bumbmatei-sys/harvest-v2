/** Derived from Shadcn UI Kit item payment-methods1 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CopyButton } from "@/components/copy-button";
import { GivingMark } from "@/components/giving/giving-logos";
import { ReportGiving } from "@/components/giving/ways-to-give-report";
import { formatIban, type GivingPublicMethod } from "@/lib/ways-to-give";

/**
 * The public "Ways to give" block as the kit's payment method card: one tile per enabled method (its brand mark, generic for a bank transfer and brands
 * without a verified mark, see giving-logos.tsx), the chosen method's copyable account details and its Give link (new tab), and the note that gifts go
 * directly to the ministry. One component for the link-in-bio page, the owner preview and any public page that embeds it. `inert` makes links
 * non-navigating (previews). Nothing is fetched and nothing is paid here.
 */
export function WaysToGive({ methods, title, ministryName, inert = false, headingLevel = 2, reportUrl }: {
  methods: GivingPublicMethod[]; title?: string; ministryName: string; inert?: boolean; headingLevel?: 2 | 3 | 4;
  /** The page's own report route (link in bio: `/l/{handle}/report`). Omitted in previews: no Report button. */
  reportUrl?: string;
}) {
  const t = useTranslations("WaysToGive.public"), id = useId();
  const [selected, setSelected] = useState(methods[0]?.id ?? "");
  if (!methods.length) return null;
  const method = methods.find((item) => item.id === selected) ?? methods[0];
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const inertProps = inert ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  const detail = (key: string, label: string, value: string, copy: string, mono = false) => (
    <div key={key} className="grid gap-2">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={`${id}-${key}`} readOnly value={value} className={mono ? "min-h-11 font-mono lg:min-h-9" : "min-h-11 lg:min-h-9"} />
        <CopyButton value={copy} label={t("copy", { item: label })} />
      </div>
    </div>
  );

  return (
    <Card role="region" aria-labelledby={`${id}-title`} className="w-full shadow-none" data-ways-to-give>
      <CardHeader>
        <CardTitle><Heading id={`${id}-title`}>{title || t("title")}</Heading></CardTitle>
        <CardDescription data-giving-notice>{t("notice", { ministry: ministryName.trim() || t("theMinistry") })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <RadioGroup value={method.id} onValueChange={setSelected} aria-label={title || t("title")} className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {methods.map((item) => (
          <div key={item.id} data-giving-method={item.kind}>
            <RadioGroupItem value={item.id} id={`${id}-${item.id}`} className="peer sr-only" aria-label={item.label} />
            <Label
              htmlFor={`${id}-${item.id}`}
              className="border-muted hover:bg-muted hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary flex h-full min-h-11 flex-col items-center justify-between rounded-md border bg-transparent p-4 text-center break-words">
              <GivingMark kind={item.kind} label={t(`kinds.${item.kind}`)} className="mb-3 size-6" />
              {item.label}
            </Label>
          </div>
          ))}
        </RadioGroup>
        {(method.handle || method.iban || method.note) && <>
          {method.handle && detail("handle", t("handle"), method.handle, method.handle)}
          {method.iban && detail("iban", t("iban"), formatIban(method.iban), method.iban, true)}
          {(method.bic || method.accountHolder) && <div className="grid gap-4 sm:grid-cols-2">
            {method.bic && detail("bic", t("bic"), method.bic, method.bic, true)}
            {method.accountHolder && detail("holder", t("accountHolder"), method.accountHolder, method.accountHolder)}
          </div>}
          {method.note && detail("note", t("reference"), method.note, method.note)}
        </>}
      </CardContent>
      {(method.url || (reportUrl && !inert)) && (
      <CardFooter className="flex-col gap-2">
        {method.url && <Button asChild className="min-h-11 w-full lg:min-h-9">
          <a href={method.url} target="_blank" rel="noopener noreferrer" {...inertProps}>
            {t("give")}<ExternalLink aria-hidden="true" /><span className="sr-only">{t("newTab")}</span>
          </a>
        </Button>}
        {reportUrl && !inert && <div className="flex w-full justify-end"><ReportGiving url={reportUrl} /></div>}
      </CardFooter>
      )}
    </Card>
  );
}
