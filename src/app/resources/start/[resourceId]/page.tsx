import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { PublicFrame } from "@/components/connect/public-frame";
import { Button } from "@/components/ui/button";
import { getStarterResource } from "@/lib/connect-public";

export async function generateMetadata({ params }: { params: Promise<{ resourceId: string }> }) {
  const resource = getStarterResource((await params).resourceId);
  const t = await getTranslations("Connect");
  return { title: resource ? t(`resources.${resource.id}.title`) : t("unavailableTitle"), description: t("freeNotice") };
}

export default async function StarterResource({ params }: { params: Promise<{ resourceId: string }> }) {
  const resource = getStarterResource((await params).resourceId);
  if (!resource) notFound();
  const t = await getTranslations("Connect");
  return <PublicFrame>
    <Button asChild variant="outline" className="mb-8 min-h-11"><Link prefetch={false} href="/resources/start"><ArrowLeft aria-hidden="true" />{t("allResources")}</Link></Button>
    <article className="max-w-prose space-y-8">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(`resources.${resource.id}.format`)}</p>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{t(`resources.${resource.id}.title`)}</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{t(`resources.${resource.id}.description`)}</p>
      </div>
      {resource.sections.map((section) => <section key={section} className="space-y-3">
        <h2 className="text-xl font-semibold leading-snug">{t(`resources.${resource.id}.sections.${section}.title`)}</h2>
        <p className="text-base leading-7">{t(`resources.${resource.id}.sections.${section}.body`)}</p>
      </section>)}
    </article>
  </PublicFrame>;
}
