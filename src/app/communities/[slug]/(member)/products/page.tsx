import { CommunityShelfPage } from "@/components/communities/community-shelf-page";

type Props = { params: Promise<{ slug: string }> };

// C16: the community Products tab. The free products the community shows; opening one follows the canonical product access check.
export default async function ProductsPage({ params }: Props) { return <CommunityShelfPage slug={(await params).slug} kind="download" />; }
