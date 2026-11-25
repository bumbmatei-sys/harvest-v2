import { CatalogPublicPage, resolvePublicItem } from "@/components/catalog/catalog-public-page";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const item = await resolvePublicItem((await params).slug, "download");
  return item ? { title: item.title, referrer: "no-referrer" as const, robots: { index: false, follow: false } } : { robots: { index: false, follow: false } };
}
export default async function ProductPage({ params }: Props) { return <CatalogPublicPage slug={(await params).slug} kind="download" />; }
