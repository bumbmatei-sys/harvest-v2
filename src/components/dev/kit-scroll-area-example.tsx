/** Derived from Shadcn UI Kit item scroll-area1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 1). Local changes: docs/ui-sources.md. */
"use client";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const rows = Array.from({ length: 50 }, (_, index) => index + 1);

/** The kit's scroll area demo: a fixed-height list with separators. The viewport is focusable because its rows are plain text. */
export function KitScrollAreaExample() {
  const t = useTranslations("UiShowcase.primitives");
  return <ScrollArea className="h-72 w-full rounded-md border sm:max-w-xs" viewportProps={{ tabIndex: 0, role: "region", "aria-label": t("scrollList") }}>
    <div className="p-4"><h3 className="mb-4 text-sm leading-none font-medium">{t("scrollListTitle")}</h3>
      {rows.map(number => <Fragment key={number}><div className="text-sm">{t("scrollRow", { number })}</div><Separator className="my-2" /></Fragment>)}</div>
  </ScrollArea>;
}
