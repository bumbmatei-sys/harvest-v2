import { randomUUID } from "node:crypto";
import { FakeMailProvider } from "../mail/fake-provider";
import { FakeStore } from "./fake-store";
import {
  available, calendarWriteGrant, grant, type EventDetail, type FileDetail, type Health, type OfficeAccount, type OfficeProvider,
  type OfficeResult, type ProviderRequest, type SendContent,
} from "./port";
import { OfficeProviderError, type Credential } from "./types";

const testCredential = { secret: "fake-credential" };
type Window = { start: string; end: string };
type Draft = { ref: string; version: string; subject: string; to: string[]; body: string };
export type FakeCalendar = { ref: string; name: string; primary?: boolean; readOnly?: boolean; timezone?: string | null };
const defaultCalendars: FakeCalendar[] = [{ ref: "primary", name: "Personal calendar", primary: true, timezone: "America/New_York" }];
type FakeAccount = OfficeAccount & {
  health: Health;
  calendars: FakeCalendar[];
  events: EventDetail[];
  files: FileDetail[];
  drafts: Map<string, Draft>;
};
type Attempt = { account: FakeAccount; expiresAt: Date; access?: "write" };
const missing = () => new OfficeProviderError("NOT_FOUND");
const conflict = () => new OfficeProviderError("CONFLICT");

function clippedBusy(events: EventDetail[], window: Window, calendarRef?: string) {
  const from = Date.parse(window.start), to = Date.parse(window.end);
  const intervals = events.filter(event => !calendarRef || event.calendarRef === calendarRef)
    .map(event => [Math.max(Date.parse(event.start), from), Math.min(Date.parse(event.end), to)])
    .filter(([start, end]) => start < end).sort(([a], [b]) => a - b);
  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
}

/**
 * Where the demo calendar's sample event sits: the next whole hour that is at least an hour away, for 30 minutes. A whole hour keeps the event inside one day in every
 * zone whose offset is a multiple of 30 minutes, so it never spans midnight (in UTC or the calendar's zone) whatever time of day the demo is connected, and it is always upcoming.
 */
export function sampleEventWindow(now: Date) {
  const hour = 3_600_000, start = Math.ceil((now.getTime() + hour) / hour) * hour;
  return { start: new Date(start), end: new Date(start + 30 * 60_000) };
}

/** Synthetic Office accounts, isolated by account and profile, with no transport. */
export class FakeOfficeProvider implements OfficeProvider {
  readonly id = "fake" as const;
  private readonly mailbox = new Map<string, FakeMailProvider>();
  private readonly connected = new Map<string, FakeAccount>();
  private readonly attempts = new Map<string, Attempt>();

  private readonly store: FakeStore;

  constructor(secret: string, private readonly now = () => new Date(), private readonly demo = false) {
    this.store = new FakeStore([], secret);
  }

  private getAccount(credential: Credential, account: OfficeAccount) {
    this.store.authorize(credential);
    const known = this.connected.get(account.ref);
    if (!known || known.profileRef !== account.profileRef || known.kind !== account.kind || known.platform !== account.platform) throw missing();
    return known;
  }

  async startConnect(credential: Credential, request: Parameters<OfficeProvider["startConnect"]>[1]) {
    this.store.authorize(credential);
    const now = this.now();
    for (const [ref, attempt] of this.attempts) if (attempt.expiresAt <= now) this.attempts.delete(ref);
    const known = request.existing ? this.connected.get(request.existing.ref) : undefined;
    const account: FakeAccount = known ? this.getAccount(credential, request.existing!) : {
      ref: randomUUID(), profileRef: randomUUID(), platform: request.platform, kind: request.kind,
      health: { health: "healthy", grants: grant[request.kind] }, calendars: structuredClone(defaultCalendars), events: [], files: [], drafts: new Map(),
      ...request.existing,
    };
    const expiresAt = new Date(now.getTime() + 30 * 60_000);
    this.attempts.set(request.attemptId, { account, expiresAt, access: request.access });
    return { profileRef: account.profileRef, handoffRef: request.attemptId, expiresAt, url: null };
  }

  async finishConnect(credential: Credential, request: Parameters<OfficeProvider["finishConnect"]>[1]): ReturnType<OfficeProvider["finishConnect"]> {
    this.store.authorize(credential);
    const attempt = this.attempts.get(request.handoffRef);
    const account = attempt?.account;
    if (!attempt || !account || attempt.expiresAt <= this.now() || account.profileRef !== request.profileRef ||
      account.platform !== request.platform || account.kind !== request.kind || (request.expectedRef && account.ref !== request.expectedRef)) return { state: "failed" };
    account.health = { health: "healthy", grants: grant[account.kind] | (attempt.access === "write" ? calendarWriteGrant : 0) };
    const firstConnection = !this.connected.has(account.ref);
    this.connected.set(account.ref, account);
    if (account.kind === "mail" && !this.mailbox.has(account.ref)) this.mailbox.set(account.ref, new FakeMailProvider([account.ref]));
    if (firstConnection && this.demo) this.seedDemo(credential, account);
    return { state: "connected", accountRef: account.ref, health: structuredClone(account.health) };
  }

  async health(credential: Credential, account: OfficeAccount) {
    return structuredClone(this.getAccount(credential, account).health);
  }

  async disconnect(credential: Credential, account: OfficeAccount) {
    this.getAccount(credential, account);
    this.connected.delete(account.ref);
    this.mailbox.delete(account.ref);
    for (const [ref, attempt] of this.attempts) if (attempt.account.ref === account.ref) this.attempts.delete(ref);
  }

  async thread(credential: Credential, account: OfficeAccount, threadRef: string) {
    this.getAccount(credential, account);
    const provider = this.mailbox.get(account.ref);
    if (!provider) throw missing();
    const { items } = await provider.listMessages(testCredential, { accountRef: account.ref, threadRef, limit: 100 });
    if (!items.length) throw missing();
    return { ref: threadRef, subject: items[0].subject, messages: items.map(({ ref, subject, body, from, to }) => ({ ref, subject, body, from, to })) };
  }

  async event(credential: Credential, account: OfficeAccount, eventRef: string, calendarRef?: string) {
    const result = this.getAccount(credential, account).events.find(event => event.ref === eventRef && (!calendarRef || calendarRef === event.calendarRef));
    if (!result) throw missing();
    return structuredClone(result);
  }

  async file(credential: Credential, account: OfficeAccount, fileRef: string) {
    const result = this.getAccount(credential, account).files.find(file => file.ref === fileRef);
    if (!result) throw missing();
    return structuredClone(result);
  }

  async perform(credential: Credential, account: OfficeAccount, request: ProviderRequest): Promise<OfficeResult> {
    const stored = this.getAccount(credential, account);
    const { input, action } = request;
    const mailbox = this.mailbox.get(account.ref);
    const paged = <T>(rows: T[], input: { cursor?: string; limit?: number }) => available(this.store.page(rows, { ...input, accountRef: account.ref }));
    const getDraft = (ref: string, version?: string) => {
      const result = stored.drafts.get(ref);
      if (!result) throw missing();
      if (version && result.version !== version) throw conflict();
      return result;
    };
    const putDraft = (content: Omit<Draft, "ref" | "version">, ref: string = randomUUID()) => {
      const result = { ...structuredClone(content), ref, version: randomUUID() };
      stored.drafts.set(ref, result);
      return available(structuredClone(result));
    };
    switch (action) {
      case "threads": return available(await mailbox!.listThreads(testCredential, { ...input, accountRef: account.ref }));
      case "thread": return available(await this.thread(credential, account, input.threadRef));
      case "folders": return available({ items: [{ ref: "inbox", name: "Inbox" }, { ref: "archive", name: "Archive" }] });
      case "labels": return available({ items: [{ ref: "important", name: "Important" }] });
      case "drafts": return paged([...stored.drafts.values()].reverse(), input);
      case "draft": return available(structuredClone(getDraft(input.draftRef)));
      case "createDraft": return this.store.once(account.ref, "draft", input.requestId, input.content, () => putDraft(input.content));
      case "updateDraft":
        getDraft(input.draftRef, input.version);
        return putDraft(input.content, input.draftRef);
      case "deleteDraft":
        getDraft(input.draftRef);
        stored.drafts.delete(input.draftRef);
        return available({ deleted: true });
      case "calendars": return available({ items: structuredClone(stored.calendars) });
      case "events": return paged(stored.events.filter(row => (!input.calendarRef || row.calendarRef === input.calendarRef) &&
        Date.parse(row.start) < Date.parse(input.end) && Date.parse(row.end) > Date.parse(input.start)), input);
      case "event": return available(await this.event(credential, account, input.eventRef, input.calendarRef));
      case "freeBusy": return available({ items: clippedBusy(stored.events, input, input.calendarRef) });
      case "availability": {
        const items: Window[] = [];
        const start = Date.parse(input.start), duration = input.durationMinutes * 60_000;
        let cursor = start;
        for (const block of [...clippedBusy(stored.events, input), { start: input.end, end: input.end }]) {
          for (; cursor + duration <= Date.parse(block.start); cursor += duration) {
            if (items.length === 100) return available({ items, partial: true });
            items.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + duration).toISOString() });
          }
          cursor = Math.max(cursor, Date.parse(block.end));
        }
        return available({ items, partial: false });
      }
      case "createEvent":
      case "updateEvent": {
        const write = () => {
          const calendar = stored.calendars.find(row => row.ref === input.calendarRef);
          if (!calendar) throw missing();
          if (calendar.readOnly) throw new OfficeProviderError("INVALID_REQUEST");
          const previous = action === "updateEvent" ? stored.events.find(event => event.ref === input.eventRef && event.calendarRef === input.calendarRef) : null;
          if (action === "updateEvent" && !previous) throw missing();
          if (previous && "version" in input && previous.version !== input.version) throw conflict();
          const eventRef = previous?.ref ?? randomUUID();
          const meetingKind = account.platform === "google" ? "meet" as const : "teams" as const;
          const { meeting, timezone, ...fields } = input.event;
          const result: EventDetail = { ...fields, ref: eventRef, calendarRef: input.calendarRef, version: randomUUID(), timezone: timezone ?? calendar.timezone ?? undefined,
            meetingLink: meeting ? `https://meeting.example.test/${eventRef}` : null,
            meetingKind: meeting ? meetingKind : undefined,
          };
          stored.events = [...stored.events.filter(event => event.ref !== eventRef), result];
          return available(structuredClone(result));
        };
        return action === "createEvent" ? this.store.once(account.ref, action, input.requestId, input, write) : write();
      }
      case "deleteEvent": {
        const previous = await this.event(credential, account, input.eventRef, input.calendarRef);
        if (previous.version !== input.version) throw conflict();
        stored.events = stored.events.filter(event => event.ref !== previous.ref);
        return available({ deleted: true });
      }
      case "drives": return available({ items: [{ ref: "root", name: "Personal drive" }] });
      case "files": {
        if (input.folderRef && input.folderRef !== "root" && !stored.files.some(row => row.ref === input.folderRef && row.kind === "folder")) throw missing();
        return paged(stored.files.filter(row => input.search
          ? (!input.folderRef || input.folderRef === "root" || input.folderRef === row.parentRef) && row.name.toLowerCase().includes(input.search.toLowerCase())
          : (row.parentRef ?? "root") === (input.folderRef ?? "root")), input);
      }
      case "file": return available(await this.file(credential, account, input.fileRef));
      case "preview": {
        const result = await this.file(credential, account, input.fileRef);
        return result.webUrl ? available({ url: result.webUrl }) : { state: "unavailable" };
      }
      case "downloadLink": {
        const result = await this.file(credential, account, input.fileRef);
        return result.kind === "file" ? available({ url: `https://download.example.test/${encodeURIComponent(result.ref)}` }) : { state: "unavailable" };
      }
      case "picker": return account.platform === "google" ? available({ mode: "inline" }) : { state: "unavailable" };
    }
  }


  async simulateDelivery(credential: Credential, account: OfficeAccount, content: SendContent, idempotencyKey: string) {
    this.getAccount(credential, account);
    const mailbox = this.mailbox.get(account.ref);
    if (!mailbox) throw missing();
    const input = { ...content, accountRef: account.ref, idempotencyKey };
    if (!content.messageRef) return mailbox.send(testCredential, input);
    const source = mailbox.findMessage(testCredential, account.ref, content.messageRef);
    return mailbox.reply(testCredential, { ...input, messageRef: source.ref,
      to: content.to.length ? content.to : [source.from], subject: content.subject || `Re: ${source.subject}`,
    });
  }

  /** Test and demo helper: the provider changes an event on its side, so its version moves. */
  touchEvent(credential: Credential, account: OfficeAccount, eventRef: string) {
    const event = this.getAccount(credential, account).events.find(row => row.ref === eventRef);
    if (!event) throw missing();
    event.version = randomUUID();
  }

  seed(credential: Credential, account: OfficeAccount, values: { messages?: Parameters<FakeMailProvider["seedMessage"]>[1][]; calendars?: FakeCalendar[]; events?: EventDetail[]; files?: FileDetail[] }) {
    const stored = this.getAccount(credential, account);
    if (values.calendars) stored.calendars = structuredClone(values.calendars);
    for (const message of values.messages ?? []) this.mailbox.get(account.ref)?.seedMessage(account.ref, message);
    if (values.events) stored.events = structuredClone(values.events).map(event => ({ version: "seed", ...event }));
    if (values.files) stored.files = structuredClone(values.files);
  }

  private seedDemo(credential: Credential, account: OfficeAccount) {
    if (account.kind === "mail") this.seed(credential, account, { messages: [{
      ref: "sample-message", threadRef: "sample-thread", subject: "Planning tomorrow’s meeting",
      body: "Could we review the agenda before the meeting?", from: "sender@example.test", to: ["recipient@example.test"], labelRefs: ["inbox"],
    }] });
    if (account.kind === "calendar") {
      const window = sampleEventWindow(this.now());
      this.seed(credential, account, { events: [{
        ref: "sample-event", calendarRef: "primary", title: "Planning meeting", start: window.start.toISOString(),
        end: window.end.toISOString(), attendees: ["participant@example.test"], meetingLink: null,
      }] });
    }
    if (account.kind === "files") this.seed(credential, account, { files: [{
      ref: "sample-file", name: "Meeting agenda.txt", kind: "file", parentRef: null, mimeType: "text/plain", size: 27, webUrl: null,
    }] });
  }

  setHealth(credential: Credential, account: OfficeAccount, value: Health) {
    this.getAccount(credential, account).health = structuredClone(value);
  }
}
