import type { AccountProvider, Credential, Page, Query } from "../office-provider/types";
export type AvailabilitySlot = { start: string; end: string };
export type CalendarEvent = AvailabilitySlot & { ref: string; title: string; attendees: string[]; meetingLink: string | null; rsvp: "pending" | "accepted" | "declined" | "tentative" };
export type EventWrite = AvailabilitySlot & { accountRef: string; title: string; attendees: string[]; createMeetingLink?: boolean };
export interface CalendarProvider extends AccountProvider {
  listEvents(c: Credential, q: Query): Promise<Page<CalendarEvent>>;
  createEvent(c: Credential, input: EventWrite & { idempotencyKey: string }): Promise<CalendarEvent>;
  updateEvent(c: Credential, input: EventWrite & { eventRef: string }): Promise<CalendarEvent>;
  deleteEvent(c: Credential, accountRef: string, eventRef: string): Promise<void>;
  rsvp(c: Credential, accountRef: string, eventRef: string, response: CalendarEvent["rsvp"]): Promise<void>;
  findFreeTime(c: Credential, accountRef: string, window: AvailabilitySlot): Promise<AvailabilitySlot[]>;
}
