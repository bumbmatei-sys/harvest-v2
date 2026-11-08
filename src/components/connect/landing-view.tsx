import Link from "next/link";
import { useTranslations } from "next-intl";
import { PersonalizedCards } from "./personalized-cards";
import { ArrowRight, BookOpen, MessageCircle, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { LandingView } from "@/lib/connect-public";

// The guest landing for the HC-04 preview and HC-03 published campaign links. Only fields of the
// public projection are rendered. Connection and account choices stay unavailable until HC-05/07.
export function LandingContent({ landing, responseHref, invitationAvailable=false, preview=false }: { landing: LandingView; responseHref?: string;invitationAvailable?:boolean; preview?:boolean }) {
  const t = useTranslations("Connect");
  const intake = useTranslations("Intake");
  const invitation=useTranslations("Invitations");
  const editor = useTranslations("LandingEditor");
  const definition = landing.source === "campaign-link" ? landing.definition : undefined;
  const title = landing.source === "campaign-link" ? landing.title : null;
  return <div className="@container">
    <div className="mb-10 max-w-2xl space-y-5 sm:mb-14">
      {landing.source === "starter-preview" && <Badge variant="secondary">{t("preview")}</Badge>}
      {title && <p className="break-words text-base font-medium text-muted-foreground">{title}</p>}
      <h1 className="whitespace-pre-wrap break-words text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{definition?.heading || t("welcome")}</h1>
      <p className="whitespace-pre-wrap break-words text-lg leading-relaxed text-muted-foreground">{definition?.message || t("welcomeBody")}</p>
      <p className="text-sm text-muted-foreground">{definition ? editor("offersNotice") : t("freeNotice")}</p>
      {definition && <Button asChild className="min-h-11 whitespace-normal"><Link prefetch={false} href="/resources/start">{editor("freeAction")}<ArrowRight aria-hidden="true" /></Link></Button>}
    </div>
    {definition && <PersonalizedCards definition={definition} />}
    <div className="mt-8 grid gap-4 @3xl:grid-cols-3">
      <Card className="border-foreground/30 bg-secondary">
        <CardHeader><BookOpen className="mb-3 size-6" aria-hidden="true" /><CardTitle><h2 className="text-xl leading-snug">{t("resourceTitle")}</h2></CardTitle><CardDescription className="text-base leading-relaxed">{t("resourceBody")}</CardDescription></CardHeader>
        <CardFooter className="mt-auto"><Button asChild className="min-h-11 w-full justify-between whitespace-normal text-start"><Link prefetch={false} href="/resources/start">{definition ? editor("freeAction") : t("browseResources")}<ArrowRight aria-hidden="true" /></Link></Button></CardFooter>
      </Card>
      {([{ key: "connection", Icon: MessageCircle }, { key: "account", Icon: UserRound }] as const).map(({ key, Icon }) => <Card key={key}>
        <CardHeader><Icon className="mb-3 size-6" aria-hidden="true" /><CardTitle><h2 className="text-xl leading-snug">{t(`${key}Title`)}</h2></CardTitle><CardDescription className="text-base leading-relaxed">{key === "account" && invitationAvailable ? invitation("landingBody") : key === "connection" && responseHref ? intake("connectionBody") : t(`${key}Body`)}</CardDescription></CardHeader>
        <CardFooter className="mt-auto">{(key === "connection" || invitationAvailable) && responseHref && !preview ? <Button asChild variant="outline" className="min-h-11 w-full whitespace-normal"><Link prefetch={false} href={responseHref}>{key === "account"?invitation("landingAction"):intake("openForm")}</Link></Button> : <Button disabled variant="outline" className="min-h-11 w-full">{preview && responseHref && (key === "connection" || invitationAvailable) ? (key === "account" ? invitation("landingAction") : intake("openForm")) : t("comingSoon")}</Button>}</CardFooter>
      </Card>)}
    </div>
  </div>;
}
