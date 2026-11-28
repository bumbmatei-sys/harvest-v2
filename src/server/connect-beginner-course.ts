import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { message } from "../i18n/messages";
import { normalizeShortCode, publicCodePattern } from "../lib/connect-links";
import type { LessonVideo } from "../lib/lesson-video";
import type { RichDoc } from "../lib/rich-text";
import { receiptHash } from "./connect-receipt";
import { requireSyntheticIntake, withSyntheticIntake } from "./connect-intake-context";
import { freeCatalogEnabled } from "./free-catalog-mode";
import { AccessError } from "./permissions";
import { withTenant, withUser } from "./tenancy";

const unavailable = () => new AccessError(404, message("Intake.unavailable"));
const setting = z.object({ beginnerCourseId: z.uuid().nullable() }).strict();
type CourseSetting = z.infer<typeof setting>;
type Course = { slug: string; title: string; summary: string };
type CourseStart = Course & { lessons: { id: string; title: string; body: RichDoc; video: LessonVideo | null }[] };
type Result = Course | CourseStart | { enrolled: true };
const proof = z.object({ receiptToken: z.string().regex(/^[a-f0-9]{64}$/) });
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/);
export const beginnerCourseInput = z.discriminatedUnion("action", [
  proof.extend({ action: z.literal("offer") }).strict(),
  proof.extend({ action: z.literal("start"), slug }).strict(),
  proof.extend({ action: z.literal("enrol"), slug }).strict(),
]);

export function connectCourseSetting(db: Database, actor: string, workspace: string, raw?: unknown) {
  requireSyntheticIntake();
  if (!freeCatalogEnabled()) throw unavailable();
  const write = raw !== undefined;
  const input = write ? setting.parse(raw) : null;
  return withTenant(db, actor, z.uuid().parse(workspace), "connect:publish", async (tx, tenant) => {
    const { rows: [row] } = await tx.execute<{ result: CourseSetting | null }>(sql`
      select public.connect_course_settings_access(${tenant}::uuid,${write},${input?.beginnerCourseId ?? null}::uuid) as result`);
    if (!row?.result) throw unavailable();
    return row.result;
  });
}

export async function connectBeginnerCourse(db: Database, kind: string, code: string, raw: unknown, actor?: string) {
  requireSyntheticIntake();
  if (!freeCatalogEnabled()) throw unavailable();
  const input = beginnerCourseInput.parse(raw);
  const normalized = kind === "qr" && publicCodePattern.test(code) ? code : kind === "short" ? normalizeShortCode(code) : null;
  if (!normalized) throw unavailable();
  const load = (tx: Transaction) => tx.execute<{ result: Result | null }>(sql`
    select public.connect_beginner_course(${kind},${normalized},${receiptHash(input.receiptToken)},${input.action},
      ${input.action === "offer" ? null : input.slug}) as result`);
  if (input.action === "enrol" && !actor) throw new AccessError(401, message("Errors.signInToContinue"));
  const { rows: [row] } = input.action === "enrol" && actor
    ? await withUser(db, actor, async tx => {
        await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
        return load(tx);
      })
    : await withSyntheticIntake(db, load);
  if (!row?.result) throw unavailable();
  return row.result;
}
