import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, BookOpen, MessageCircle, UserRound } from "lucide-react";
import { PublicFrame } from "@/components/connect/public-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicLanding } from "@/lib/connect-public";

export async function generateMetadata() {
  const t = await getTranslations("Connect");
  return { title: t("landingMetaTitle"), description: t("freeNotice"), robots: { index: false, follow: false } };
}

export default async function ConnectLanding({ params }: { params: Promise<{ publicCode: string }> }) {
  const landing = getPublicLanding((await params).publicCode);
  if (!landing) notFound();
  const t = await getTranslations({ locale: landing.locale, namespace: "Connect" });
  return <PublicFrame>
    <div className="mb-10 max-w-2xl space-y-5 sm:mb-14">
      <Badge variant="secondary">{t("preview")}</Badge>
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
        <CardHeader><Icon className="mb-3 size-6" aria-hidden="true" /><CardTitle><h2 className="text-xl leading-snug">{t(`${key}Title`)}</h2></CardTitle><CardDescription className="text-base leading-relaxed">{t(`${key}Body`)}</CardDescription></CardHeader>
        <CardFooter className="mt-auto"><Button disabled variant="outline" className="min-h-11 w-full">{t("comingSoon")}</Button></CardFooter>
      </Card>)}
    </div>
  </PublicFrame>;
}
