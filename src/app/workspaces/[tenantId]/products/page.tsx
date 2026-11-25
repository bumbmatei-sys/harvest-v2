import { getTranslations } from "next-intl/server";
import { CatalogListPage } from "@/components/catalog/catalog-list-page";

export async function generateMetadata() { return { title: (await getTranslations("Catalog"))("productsTitle") }; }
export default function ProductsPage({ params }: { params: Promise<{ tenantId: string }> }) { return <CatalogListPage params={params} kind="all" />; }
