import { notFound, redirect } from "next/navigation";
import { communitiesEnabled } from "@/server/communities-mode";

// The member home is the forum (C09); kept for links sent before the forum existed.
export default async function CommunityHome({ params }: { params: Promise<{ slug: string }> }) {
  if (!communitiesEnabled()) notFound();
  redirect(`/communities/${encodeURIComponent((await params).slug)}/forum`);
}
