import { getTranslations } from "next-intl/server";
import { CatalogListPage } from "@/components/catalog/catalog-list-page";

export async function generateMetadata() { return { title: (await getTranslations("Catalog"))("coursesTitle") }; }
export default function CoursesPage({ params }: { params: Promise<{ tenantId: string }> }) { return <CatalogListPage params={params} kind="course" />; }
