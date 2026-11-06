import { getTranslations } from "next-intl/server";
import { PublicFrame } from "@/components/connect/public-frame";
import { ResourceCards } from "@/components/connect/resource-cards";
import { starterResources } from "@/lib/connect-public";

export async function generateMetadata() {
  const t = await getTranslations("Connect");
  return { title: t("resourcesMetaTitle"), description: t("freeNotice") };
}

export default async function StarterResources() {
  const t = await getTranslations("Connect");
  return <PublicFrame>
    <div className="mb-10 max-w-2xl space-y-4">
      <p className="text-sm font-medium text-muted-foreground">{t("resourceEyebrow")}</p>
      <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{t("resourcesTitle")}</h1>
      <p className="text-lg leading-relaxed text-muted-foreground">{t("resourcesBody")}</p>
      <p className="text-sm text-muted-foreground">{t("lightweight")}</p>
    </div>
    <ResourceCards resourceIds={starterResources.map(({ id }) => id)} />
  </PublicFrame>;
}
