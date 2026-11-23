import { z } from "zod";
import type { ConnectionKind, Credential } from "./types";

export const officeNotice = { version: 1, key: "Office.personalConnectionNotice" } as const;
export const officeKinds = ["mail", "calendar", "files"] as const;
export const grant = { mail: 1, calendar: 2, files: 4 } as const;
/** A second, separate grant for calendar connections: permission to add events. Requested only when the person first creates one. */
export const calendarWriteGrant = 8;
export const platform = z.enum(["google", "microsoft"]);
export type OfficePlatform = z.infer<typeof platform>;
export type OfficeProviderId = "fake" | "zernio";
export type OfficeHealth = "healthy" | "unavailable" | "reconnect_needed";
export const ref = z.string().min(1).max(200).refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value) && ![".", ".."].includes(value));
export const dateTime = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().max(max).refine(value => value.isWellFormed() && !value.includes("\u0000"));
const range = {
  start: dateTime,
  end: dateTime,
};
export const cursorInput = z.string().min(1).max(4096).refine(value => value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value));
const page = { cursor: cursorInput.optional(), limit: z.number().int().min(1).max(100).optional() };
export const mailContent = z.strictObject({
  to: z.array(z.email().max(254)).max(20), subject: text(500), body: text(20_000),
});
const sendContent = mailContent.extend({ messageRef: ref.optional() }).refine(value => value.body.trim() && (value.messageRef || (value.to.length > 0 && value.subject.trim())));
const plainDate = z.iso.date();
const zoneName = z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } });
/** A single event (no recurrence). An all-day event uses plain dates with an exclusive end; a timed one uses instants. Attendees are accepted by the schema but refused by the server in version 1. */
const event = z.strictObject({
  start: z.union([dateTime, plainDate]), end: z.union([dateTime, plainDate]), allDay: z.boolean().optional(), timezone: zoneName.optional(),
  title: text(500).min(1), description: text(8000).optional(),
  attendees: z.array(z.email().max(254)).max(50), meeting: z.boolean().optional(),
}).refine(value => {
  const dated = plainDate.safeParse(value.start).success && plainDate.safeParse(value.end).success;
  return (value.allDay ? dated : !plainDate.safeParse(value.start).success && !plainDate.safeParse(value.end).success) && Date.parse(value.start) < Date.parse(value.end);
});

export const providerOperations = {
  threads: z.strictObject({ ...page, folderRef: ref.optional(), search: text(300).min(1).optional() }),
  thread: z.strictObject({ threadRef: ref }),
  folders: z.strictObject({}),
  labels: z.strictObject({}),
  drafts: z.strictObject(page),
  draft: z.strictObject({ draftRef: ref }),
  createDraft: z.strictObject({ content: mailContent, requestId: z.uuid() }),
  updateDraft: z.strictObject({ draftRef: ref, version: ref, content: mailContent }),
  deleteDraft: z.strictObject({ draftRef: ref }),
  calendars: z.strictObject({ writableOnly: z.boolean().optional() }),
  events: z.strictObject({ ...page, ...range, calendarRef: ref.optional() }),
  event: z.strictObject({ eventRef: ref, calendarRef: ref.optional() }),
  freeBusy: z.strictObject({ ...range, calendarRef: ref.optional() }),
  availability: z.strictObject({ ...range, durationMinutes: z.number().int().min(5).max(480) }),
  createEvent: z.strictObject({ calendarRef: ref, event, requestId: z.uuid() }),
  updateEvent: z.strictObject({ eventRef: ref, calendarRef: ref, version: ref, event }),
  deleteEvent: z.strictObject({ eventRef: ref, calendarRef: ref, version: ref }),
  drives: z.strictObject({}),
  files: z.strictObject({ ...page, folderRef: ref.optional(), search: text(300).min(1).optional() }),
  file: z.strictObject({ fileRef: ref }),
  preview: z.strictObject({ fileRef: ref }),
  downloadLink: z.strictObject({ fileRef: ref }),
  picker: z.strictObject({}),
};
export type Operation = keyof typeof providerOperations;
export type OperationInput<K extends Operation> = z.infer<(typeof providerOperations)[K]>;
export type ProviderRequest = { [K in Operation]: { action: K; input: OperationInput<K> } }[Operation];
export type SendContent = z.infer<typeof sendContent>;

export const officeActions = {
  ...providerOperations,
  startConnect: z.strictObject({ kind: z.enum(officeKinds), platform, noticeVersion: z.literal(officeNotice.version), access: z.literal("write").optional() })
    .refine(value => value.access === undefined || value.kind === "calendar"),
  finishConnect: z.strictObject({ attemptId: z.uuid() }),
  health: z.strictObject({}),
  disconnect: z.strictObject({}),
  marker: z.strictObject({ threadRef: ref, read: z.boolean().optional(), starred: z.boolean().optional(), contactId: z.uuid().nullable().optional() })
    .refine(value => value.read !== undefined || value.starred !== undefined || value.contactId !== undefined),
  fileLink: z.strictObject({ fileRef: ref, contactId: z.uuid() }),
  eventLink: z.strictObject({ eventRef: ref, calendarRef: ref.optional(), contactId: z.uuid() }),
  contactReferences: z.strictObject({ contactId: z.uuid() }),
  removeReference: z.strictObject({ contactId: z.uuid(), itemRef: ref }),
  reviewMail: z.strictObject({ content: sendContent }),
  sendMail: z.strictObject({ content: sendContent, reviewToken: z.uuid() }),
};
export type OfficeAction = keyof typeof officeActions;
export type OfficeRequest = { [K in OfficeAction]: { action: K; input: z.infer<(typeof officeActions)[K]>; connectionId?: string } }[OfficeAction];

export const operationKind: Record<Operation, ConnectionKind> = {
  threads: "mail", thread: "mail", folders: "mail", labels: "mail", drafts: "mail", draft: "mail",
  createDraft: "mail", updateDraft: "mail", deleteDraft: "mail",
  calendars: "calendar", events: "calendar", event: "calendar", freeBusy: "calendar", availability: "calendar",
  createEvent: "calendar", updateEvent: "calendar", deleteEvent: "calendar",
  drives: "files", files: "files", file: "files", preview: "files", downloadLink: "files", picker: "files",
};

export type OfficeAccount = { ref: string; platform: OfficePlatform; kind: ConnectionKind; profileRef: string };
export type Health = { health: OfficeHealth; grants: number };
export type ConnectAttempt = { profileRef: string; handoffRef: string; url: string | null; expiresAt: Date };
export type ConnectResult = { state: "pending" | "failed" } | { state: "connected"; accountRef: string; health: Health };
export type OfficeResult<T extends object = object> = { state: "available"; data: T } | { state: "unavailable" | "reconnect_needed" | "temporarily_unavailable" | "disabled" | "write_access_needed" };
export const available = <T extends object>(data: T) => ({ state: "available", data }) as const;

export interface OfficeProvider {
  readonly id: OfficeProviderId;
  startConnect(credential: Credential, request: { attemptId: string; platform: OfficePlatform; kind: ConnectionKind; access?: "write"; existing?: OfficeAccount }): Promise<ConnectAttempt>;
  finishConnect(credential: Credential, request: { platform: OfficePlatform; kind: ConnectionKind; profileRef: string; handoffRef: string; expectedRef?: string }): Promise<ConnectResult>;
  health(credential: Credential, account: OfficeAccount): Promise<Health>;
  disconnect(credential: Credential, account: OfficeAccount): Promise<void>;
  thread(credential: Credential, account: OfficeAccount, threadRef: string): Promise<ThreadDetail>;
  event(credential: Credential, account: OfficeAccount, eventRef: string, calendarRef?: string): Promise<EventDetail>;
  file(credential: Credential, account: OfficeAccount, fileRef: string): Promise<FileDetail>;
  perform(credential: Credential, account: OfficeAccount, request: ProviderRequest): Promise<OfficeResult>;
}

export type ThreadDetail = { ref: string; subject: string; messages: { ref: string; subject: string; body: string; from: string; to: string[]; date?: string; bodyUnavailable?: boolean }[] };
export type EventDetail = { ref: string; calendarRef: string; version?: string; timezone?: string; title: string; description?: string; start: string; end: string; allDay?: boolean; attendees: string[]; meetingLink: string | null; meetingKind?: "meet" | "teams" };
export type FileDetail = { ref: string; name: string; kind: "file" | "folder"; parentRef: string | null; mimeType: string | null; size: number | null; webUrl: string | null };
