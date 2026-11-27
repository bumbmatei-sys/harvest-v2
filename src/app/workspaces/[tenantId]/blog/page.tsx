import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getBlog } from "@/server/blog";
import { blogEnabled } from "@/server/blog-mode";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { BlogList } from "@/components/blog/blog-list";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return { title: (await getTranslations("Blog"))("pageTitle") }; }

// The ministry's articles. Owners and admins (a collaborator with Website at manage); the blog is created the first time one of them opens it.
export default async function BlogPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!blogEnabled()) notFound();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const blog = await getBlog(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!blog) return <AccessState />;
  return <BlogList tenantId={tenantId} initial={blog} />;
}
