export type CalendarEvent = {
  id: string; title: string; description: string; startsAt: string; endsAt: string;
  updatedAt: string; status: "draft" | "published" | "cancelled"; version: number;
};

function calendarText(value: string) {
  return value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
}

function calendarTimestamp(value: string) {
  return new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function fold(line: string) {
  const lines: string[] = [];
  let text = "", length = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (length + bytes > 75) {
      lines.push(text);
      text = " ";
      length = 1;
    }
    text += char;
    length += bytes;
  }
  return [...lines, text].join("\r\n");
}

export function eventCalendarFile(event: CalendarEvent, tenantId: string) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Harvest//Events//EN",
    `METHOD:${event.status === "cancelled" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT", `UID:${event.id}.${tenantId}@events.harvest`,
    `DTSTAMP:${calendarTimestamp(event.updatedAt)}`, `LAST-MODIFIED:${calendarTimestamp(event.updatedAt)}`,
    `DTSTART:${calendarTimestamp(event.startsAt)}`, `DTEND:${calendarTimestamp(event.endsAt)}`,
    `SEQUENCE:${event.version}`, `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${calendarText(event.title)}`, `DESCRIPTION:${calendarText(event.description)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}
