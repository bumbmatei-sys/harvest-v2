/** Derived from Shadcn UI Kit item spinner1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 1). Local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";

/** The kit's spinner demo (a single small spinner) widened to the three sizes Harvest offers. */
export function KitSpinnerExample() {
  const t = useTranslations("UiShowcase.primitives");
  return <div className="flex flex-wrap items-center gap-4">{(["sm", "default", "lg"] as const).map(size => <span key={size} className="flex items-center gap-2 text-sm"><Spinner size={size} label={t(`spinner.${size}`)} />{t(`spinner.${size}`)}</span>)}</div>;
}
