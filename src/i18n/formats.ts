import type { Formats } from "next-intl";
/** Shared presentation formats. ISO strings remain for transport and datetime attributes. */
export const formats = {
  dateTime: {
    date: { year: "numeric", month: "short", day: "numeric" },
    dateTime: { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" },
    calendarDate: { year: "numeric", month: "2-digit", day: "2-digit" },
    dayLabel: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
    month: { month: "long", year: "numeric" },
    shortMonth: { month: "short" },
    weekday: { weekday: "short" },
    longWeekday: { weekday: "long" },
    day: { day: "numeric" },
    year: { year: "numeric" },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    fileSize: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    percent: { style: "percent", maximumFractionDigits: 0 },
  },
} satisfies Formats;
