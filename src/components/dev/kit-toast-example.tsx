/** Derived from Shadcn UI Kit item toast1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 1). Local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/toast";

/** Showcase button for the global toast: a title, a description and an Undo action, the pattern of the kit's toast demo. */
export function KitToastExample() {
  const t = useTranslations("UiShowcase.toast");
  return <Button size="responsive" variant="outline" onClick={() => notify.info(t("created"), { id: "showcase-example", description: t("createdDetail"), action: { label: t("undo"), onClick: () => notify.success(t("undone")) } })}>{t("show")}</Button>;
}
