// 0131 learner progress and notes: pure rules shared by the server and the learner's screens.
export const noteLimit = 4000;
/** A note is plain text: up to 4000 characters, line breaks and tabs allowed, no other control characters. Empty means "delete". */
export function validNote(value: string) {
  return value.length <= noteLimit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
/** Whole-number percentage of published lessons completed. */
export function percentComplete(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, completed) / total) * 100));
}
/**
 * Where "Continue where you left off" goes: the first lesson, in course order, after the last completed one that is not itself complete; else the
 * first incomplete lesson; else (all done) the last lesson. Null when there are no lessons.
 */
export function continueLesson(lessons: readonly { id: string }[], completed: readonly string[]): string | null {
  if (!lessons.length) return null;
  const done = new Set(completed);
  let last = -1;
  lessons.forEach((lesson, index) => { if (done.has(lesson.id)) last = index; });
  const after = lessons.slice(last + 1).find((lesson) => !done.has(lesson.id));
  return (after ?? lessons.find((lesson) => !done.has(lesson.id)) ?? lessons[lessons.length - 1]).id;
}

/** Owners and admins: counts only; a count of 1 to 4 is withheld (null). */
export type ProgressSummary = { enrolled: number | null; minimumGroup: number; lessons: { id: string; title: string; published: boolean; completed: number | null }[] };
