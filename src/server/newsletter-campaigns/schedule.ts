import { z } from "zod";
import { message } from "../../i18n/messages";

export const newsletterScheduleHorizonMs = 60 * 24 * 60 * 60_000;
export const newsletterReviewLifetimeMs = 10 * 60_000;

/** A wall-clock time with its offset and IANA zone; the offset must be the zone's own at that instant (nonexistent spring-forward times fail). */
export const localSchedule = z.object({
  at: z.iso.datetime({ offset: true, precision: 0 }),
  timezone: z.string().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/),
}).strict().superRefine(({ at, timezone }, ctx) => {
  try {
    const fields = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    if (fields.format(new Date(at)).replace(" ", "T") === at.slice(0, 19)) return;
  } catch { /* invalid zone */ }
  ctx.addIssue({ code: "custom", message: "Schedule offset must match the local time in the specified timezone" });
});

export const scheduleInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }).strict(),
  z.object({ mode: z.literal("schedule"), schedule: localSchedule }).strict(),
]).superRefine((input, ctx) => {
  if (input.mode === "schedule" && Date.parse(input.schedule.at) > Date.now() + newsletterScheduleHorizonMs) {
    ctx.addIssue({ code: "custom", path: ["schedule", "at"], message: message("NewsletterEmail.scheduleTooFar") });
  }
});
export type NewsletterSchedule = z.infer<typeof scheduleInput>;
