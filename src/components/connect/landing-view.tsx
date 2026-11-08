import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, BookOpen, MessageCircle, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { LandingView } from "@/lib/connect-public";

// The guest landing for the HC-04 preview and HC-03 published campaign links. Only fields of the
// public projection are rendered. Connection and account choices stay unavailable until HC-05/07.
export async function LandingContent({ landing, responseHref }: { landing: LandingView; responseHref?: string }) {
  const t = await getTranslations({ locale: landing.locale, namespace: "Connect" });
  const intake = await getTranslations({ locale: landing.locale, namespace: "Intake" });
  const title = landing.source === "campaign-link" ? landing.title : null;
  return <>
    <div className="mb-10 max-w-2xl space-y-5 sm:mb-14">
      {landing.source === "starter-preview" && <Badge variant="secondary">{t("preview")}</Badge>}
      {title && <p className="break-words text-base font-medium text-muted-foreground">{title}</p>}
      <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{t("welcome")}</h1>
      <p className="text-lg leading-relaxed text-muted-foreground">{t("welcomeBody")}</p>
      <p className="text-sm text-muted-foreground">{t("freeNotice")}</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="border-foreground/30 bg-secondary">
        <CardHeader><BookOpen className="mb-3 size-6" aria-hidden="true" /><CardTitle><h2 className="text-xl leading-snug">{t("resourceTitle")}</h2></CardTitle><CardDescription className="text-base leading-relaxed">{t("resourceBody")}</CardDescription></CardHeader>
        <CardFooter className="mt-auto"><Button asChild className="min-h-11 w-full justify-between whitespace-normal text-start"><Link prefetch={false} href="/resources/start">{t("browseResources")}<ArrowRight aria-hidden="true" /></Link></Button></CardFooter>
      </Card>
      {([{ key: "connection", Icon: MessageCircle }, { key: "account", Icon: UserRound }] as const).map(({ key, Icon }) => <Card key={key}>
        <CardHeader><Icon className="mb-3 size-6" aria-hidden="true" /><CardTitle><h2 className="text-xl leading-snug">{t(`${key}Title`)}</h2></CardTitle><CardDescription className="text-base leading-relaxed">{key === "connection" && responseHref ? intake("connectionBody") : t(`${key}Body`)}</CardDescription></CardHeader>
        <CardFooter className="mt-auto">{key === "connection" && responseHref ? <Button asChild variant="outline" className="min-h-11 w-full"><Link prefetch={false} href={responseHref}>{intake("openForm")}</Link></Button> : <Button disabled variant="outline" className="min-h-11 w-full">{t("comingSoon")}</Button>}</CardFooter>
      </Card>)}
    </div>
  </>;
}
