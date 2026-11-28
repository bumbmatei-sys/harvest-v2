import { catalogRoute } from "@/server/free-catalog-route";
import { downloadCourseResource } from "@/server/catalog-assets";
import { openPrivateFile } from "@/server/storage";

type Params = { slug: string; lessonId: string; fileId: string };
export const GET = catalogRoute<Params>((db, user, { slug, lessonId, fileId }, request) =>
  downloadCourseResource(db, user, slug, lessonId, fileId, new URL(request.url).searchParams.get("grant"), openPrivateFile), "read");
