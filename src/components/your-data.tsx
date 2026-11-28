/** Derived from Shadcn UI Kit item profile-block11 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { DownloadMyData } from "@/components/download-my-data";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/** The "Your data" card on the personal profile: download my data, then the way to delete the account. */
export function YourData() {
  const t = useTranslations("YourData");
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DownloadMyData />
        <Separator />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-destructive font-medium">{t("deleteLink")}</p>
            <p className="text-muted-foreground text-xs">
              {t("deleteHelp")}
            </p>
          </div>
          <Button asChild variant="destructive" size="sm" className="min-h-11">
            <Link href="/account/delete">{t("deleteLink")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
