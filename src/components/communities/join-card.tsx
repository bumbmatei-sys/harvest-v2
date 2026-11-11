"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The community join card. The editor shows it as a live preview; the public page (C05) reuses it. */
export function CommunityJoinCard({ name, tagline, host, preview = false }: { name: string; tagline: string | null; host: string; preview?: boolean }) {
  const t = useTranslations("CommunityJoinCard");
  return <Card>
    <CardHeader className="space-y-2">
      <CardTitle className="text-2xl break-words">{name || t("untitled")}</CardTitle>
      {tagline && <p className="text-sm text-muted-foreground break-words">{tagline}</p>}
      <p className="text-sm">{t("by", { host })}</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-3xl font-semibold">{t("free")}</p>
      <Button className="min-h-11 w-full" disabled={preview}>{t("join")}</Button>
      {preview && <p className="text-center text-xs text-muted-foreground">{t("previewOnly")}</p>}
    </CardContent>
  </Card>;
}
