import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export async function PublicFrame({ children,personal=false,externalOffers=false }: { children: React.ReactNode;personal?:boolean;externalOffers?:boolean }) {
  const t = await getTranslations("Connect");
  const landing=await getTranslations("LandingEditor");
  const brand=personal?(await getTranslations("Invitations"))("personalBrand"):t("brand");
  return <div className="min-h-dvh bg-background">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skipToContent")}</a>
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 lg:px-6">
        <p className="flex items-center gap-2 text-base font-semibold"><Wheat className="size-6 text-foreground" aria-hidden="true" />{brand}</p>
        <Badge variant="outline" lang="en">{t("language")}</Badge>
      </div>
    </header>
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-10 outline-none sm:py-16 lg:px-6">{children}</main>
    <footer className="mx-auto max-w-6xl border-t px-4 py-6 text-sm text-muted-foreground lg:px-6"><p>{externalOffers?landing("offersNotice"):t("freeNotice")}</p></footer>
  </div>;
}

export async function PublicUnavailable() {
  const t = await getTranslations("Connect");
  return <PublicFrame><div className="space-y-5">
    <h1 className="text-3xl font-semibold tracking-tight">{t("unavailableTitle")}</h1>
    <p className="max-w-prose text-base text-muted-foreground">{t("unavailableBody")}</p>
    <Button asChild className="min-h-11"><Link prefetch={false} href="/resources/start">{t("browseResources")}</Link></Button>
  </div></PublicFrame>;
}
