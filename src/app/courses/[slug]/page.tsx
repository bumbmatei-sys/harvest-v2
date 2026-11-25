import { CatalogPublicPage, resolvePublicItem } from "@/components/catalog/catalog-public-page";

// Resolved per request through the published-only definer: unpublishing, hiding or archiving takes effect at once.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const item = await resolvePublicItem((await params).slug, "course");
  // Only the title is shared in metadata; an unlisted or missing item is never indexed.
  return item ? { title: item.title, referrer: "no-referrer" as const, robots: { index: false, follow: false } } : { robots: { index: false, follow: false } };
}
export default async function CoursePage({ params }: Props) { return <CatalogPublicPage slug={(await params).slug} kind="course" />; }
