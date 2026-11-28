import { appOriginIfConfigured } from "@/lib/site-address";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getBlogPost } from "@/server/blog";
import { blogEnabled } from "@/server/blog-mode";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { BlogEditor } from "@/components/blog/blog-editor";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("Blog"))("editorTitle") }; }


// One article in the shared editor. Same access as the list; an article of another ministry answers the same "not available" state.
export default async function BlogPostPage({ params }: { params: Promise<{ tenantId: string; postId: string }> }) {
  if (!blogEnabled()) notFound();
  const session = await pageSession(), { tenantId, postId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(postId).success) return <AccessState />;
  const data = await getBlogPost(getDb(), session.user.id, tenantId, postId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!data) return <AccessState />;
  return <BlogEditor key={data.post.id} tenantId={tenantId} initial={data} origin={appOriginIfConfigured() ?? ""} />;
}
