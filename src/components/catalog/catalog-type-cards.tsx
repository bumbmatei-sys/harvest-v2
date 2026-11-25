import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { CatalogTypeArt } from "@/components/catalog/catalog-type-art";
import { catalogKinds } from "@/lib/catalog";

/**
 * The "New product" type picker: one card per type the server supports (course and download), each with its own code-drawn art. Each card is a link
 * to the editor for that type, so nothing is created until the owner saves. Server component: no state.
 */
export async function CatalogTypeCards({ tenantId }: { tenantId: string }) {
  const t = await getTranslations("Catalog.types");
  return <ul aria-label={t("label")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {catalogKinds.map((kind) => <li key={kind} className="min-w-0">
      <Link href={`/workspaces/${tenantId}/products/new/${kind}`} data-catalog-type={kind}
        className="group flex h-full min-h-11 flex-col overflow-hidden rounded-xl border bg-card shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <CatalogTypeArt kind={kind} className="w-full border-b" />
        <span className="flex min-w-0 flex-1 flex-col gap-1 p-4">
          <span className="text-base font-semibold">{t(`${kind}.label`)}</span>
          <span className="text-sm text-muted-foreground">{t(`${kind}.description`)}</span>
          <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-sm font-medium">{t("choose")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></span>
        </span>
      </Link>
    </li>)}
  </ul>;
}
