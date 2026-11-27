import { catalogRoute } from "@/server/free-catalog-route";
import { saveLessonNote } from "@/server/free-catalog";

type Params = { slug: string; lessonId: string };
export const PUT = catalogRoute<Params>(async (db, user, { slug, lessonId }, request) => saveLessonNote(db, user, slug, lessonId, await request.json()), "write");
