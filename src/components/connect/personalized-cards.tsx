import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { safeLandingUrl, type LandingDefinition } from "@/lib/connect-landing";

/** Shared by the published guest page and live protected editor. All text is escaped by React. */
export function PersonalizedCards({ definition }: { definition: LandingDefinition }) {
  const t = useTranslations("LandingEditor"), resources = useTranslations("Connect");
  if (!definition.cards.length) return null;
  return <section className="space-y-4" aria-label={t("suggestions")}>
    <div className="space-y-2"><h2 className="text-2xl font-semibold">{t("suggestions")}</h2><p className="text-sm text-muted-foreground">{t("externalNotice")}</p></div>
    <div className="grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-3">{definition.cards.map((card, index) => <Card key={index} className="min-w-0">
      <CardHeader className="min-w-0 space-y-3">
        <Badge variant={card.kind === "external" && card.price === "paid" ? "default" : "secondary"} className="h-auto whitespace-normal">
          {card.kind === "resource" ? t("resourceBadge") : t("externalBadge", { category: t(card.category), price: t(card.price) })}
        </Badge>
        <CardTitle><h3 className="whitespace-pre-wrap break-words text-xl">{card.kind === "resource" ? resources(`resources.${card.resourceId}.title`) : card.title}</h3></CardTitle>
        <CardDescription className="whitespace-pre-wrap break-words">{card.kind === "resource" ? resources(`resources.${card.resourceId}.description`) : card.description}</CardDescription>
      </CardHeader>
      <CardFooter className="mt-auto">{card.kind === "resource" ? <Button asChild variant="outline" className="min-h-11 w-full whitespace-normal"><Link prefetch={false} href={`/resources/start/${card.resourceId}`}>{resources(`resources.${card.resourceId}.action`)}</Link></Button>
        : safeLandingUrl(card.url) ? <Button asChild variant="outline" className="min-h-11 w-full whitespace-normal"><a href={card.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t("externalAction")}<ArrowUpRight aria-hidden="true" /></a></Button>
        : <Button disabled variant="outline" className="min-h-11 w-full whitespace-normal">{t("externalAction")}</Button>}</CardFooter>
    </Card>)}</div>
  </section>;
}
