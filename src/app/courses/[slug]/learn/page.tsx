import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { optionalSession } from "@/server/page-session";
import { freeCatalogEnabled } from "@/server/free-catalog-mode";
import { getCatalogContent } from "@/server/free-catalog";
import { AccessError } from "@/server/permissions";
import { PublicFrame } from "@/components/connect/public-frame";
import { CourseLearner, type LearnerLesson } from "@/components/catalog/course-learner";
import { publicPath } from "@/lib/catalog";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lesson?: string }> };

export async function generateMetadata() {
  return { title: (await getTranslations("CatalogPublic"))("lessons"), referrer: "no-referrer" as const, robots: { index: false, follow: false } };
}

/** The enrolled learner's lessons. Signed out goes to sign-in and back; signed in without a grant goes to the public page; a download has no lessons. */
export default async function CourseLearnPage({ params, searchParams }: Props) {
  if (!freeCatalogEnabled()) notFound();
  const { slug } = await params, { lesson } = await searchParams, here = `/courses/${slug}/learn`;
  const session = await optionalSession();
  if (!session) redirect(`/sign-in?personal=1&next=${encodeURIComponent(here)}`);
  const content = await getCatalogContent(getDb(), session.user.id, slug).catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; });
  if (!content) redirect(publicPath("course", slug));
  if (content.kind !== "course") redirect(publicPath(content.kind, slug));
  const lessons = content.lessons as LearnerLesson[];
  return <PublicFrame personal notice={false}>
    <CourseLearner slug={slug} title={content.title} lessons={lessons} currentId={lessons.find((item) => item.id === lesson)?.id ?? lessons[0]?.id ?? ""} />
  </PublicFrame>;
}
