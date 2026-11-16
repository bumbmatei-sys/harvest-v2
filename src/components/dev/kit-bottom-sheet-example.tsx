/** Derived from Shadcn UI Kit item drawer1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 1). Local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Visual reference only: the kit's drawer composition (title, body, stacked actions) on Harvest's bottom sheet. No kit code and no drawer library. */
export function KitBottomSheetExample() {
  const t = useTranslations("UiShowcase");
  return <Sheet><SheetTrigger asChild><Button size="responsive" variant="outline">{t("bottomSheet")}</Button></SheetTrigger>
    <SheetContent side="bottom"><SheetHeader><SheetTitle>{t("bottomSheet")}</SheetTitle><SheetDescription>{t("fixtureOnly")}</SheetDescription></SheetHeader>
      <SheetFooter><Button size="responsive">{t("confirmation")}</Button><SheetClose asChild><Button size="responsive" variant="outline">{t("cancel")}</Button></SheetClose></SheetFooter>
    </SheetContent></Sheet>;
}
