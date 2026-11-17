import { FakeStore } from "../office-provider/fake-store";
import { OfficeProviderError, type Credential, type Query } from "../office-provider/types";
import type { AvailabilitySlot, CalendarEvent, CalendarProvider, EventWrite } from "./port";
export class FakeCalendarProvider extends FakeStore implements CalendarProvider {
  private events = new Map<string, CalendarEvent>();
  private validate(w: AvailabilitySlot) { if (!Number.isFinite(Date.parse(w.start)) || !Number.isFinite(Date.parse(w.end)) || Date.parse(w.start) >= Date.parse(w.end)) throw new OfficeProviderError("INVALID_REQUEST"); }
  async listEvents(c: Credential, q: Query) { this.authorize(c, q.accountRef); return this.page([...this.events].filter(([key, e]) => (JSON.parse(key) as string[])[0] === q.accountRef && (!q.search || e.title.includes(q.search))).map(([, e]) => e), q); }
  async createEvent(c: Credential, input: EventWrite & { idempotencyKey: string }) { this.authorize(c, input.accountRef); this.validate(input); return this.once(input.accountRef, "event", input.idempotencyKey, input, () => { const ref = this.id("event"), event: CalendarEvent = { ref, start: input.start, end: input.end, title: input.title, attendees: [...input.attendees], meetingLink: input.createMeetingLink ? `https://meeting.example.test/${ref}` : null, rsvp: "pending" }; this.events.set(this.key(input.accountRef, ref), event); return event; }); }
  async updateEvent(c: Credential, input: EventWrite & { eventRef: string }) { this.authorize(c, input.accountRef); this.validate(input); const old = this.get(this.events, input.accountRef, input.eventRef); const event = { ...old, start: input.start, end: input.end, title: input.title, attendees: [...input.attendees] }; this.events.set(this.key(input.accountRef, input.eventRef), event); return structuredClone(event); }
  async deleteEvent(c: Credential, accountRef: string, eventRef: string) { this.authorize(c, accountRef); this.get(this.events, accountRef, eventRef); this.events.delete(this.key(accountRef, eventRef)); }
  async rsvp(c: Credential, accountRef: string, eventRef: string, response: CalendarEvent["rsvp"]) { this.authorize(c, accountRef); this.get(this.events, accountRef, eventRef).rsvp = response; }
  async findFreeTime(c: Credential, accountRef: string, window: AvailabilitySlot) {
    this.authorize(c, accountRef); this.validate(window); const end = Date.parse(window.end); let cursor = Date.parse(window.start); const slots: AvailabilitySlot[] = [];
    const busy = [...this.events].filter(([key, e]) => (JSON.parse(key) as string[])[0] === accountRef && e.rsvp !== "declined").map(([, e]) => e).sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
    for (const event of busy) { const start = Math.max(cursor, Date.parse(event.start)); if (start > cursor && cursor < end) slots.push({ start: new Date(cursor).toISOString(), end: new Date(Math.min(start, end)).toISOString() }); cursor = Math.max(cursor, Date.parse(event.end)); if (cursor >= end) break; }
    if (cursor < end) slots.push({ start: new Date(cursor).toISOString(), end: window.end }); return slots;
  }
}
