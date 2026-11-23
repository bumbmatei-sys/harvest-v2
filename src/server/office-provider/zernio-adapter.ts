import { z } from "zod";
import { OFFICE_CALENDAR_WRITE_ENABLED } from "./connections";
import {
  available, cursorInput, dateTime, grant, ref, type EventDetail, type FileDetail, type Health,
  type OfficeAccount, type OfficeProvider, type OfficeResult, type ProviderRequest, type ThreadDetail,
} from "./port";
import { OfficeProviderError, type Credential } from "./types";

export const OFFICE_LIVE_NETWORK = false;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: object;
  headers?: Record<string, string>;
};
const api = "https://zernio.com/api/v1";
const segment = encodeURIComponent;
const httpsUrl = z.url({ protocol: /^https$/ }).refine(url => {
  const parsed = new URL(url);
  return !parsed.username && !parsed.password;
});
const parse = <T>(schema: z.ZodType<T>, input: unknown) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new OfficeProviderError("TEMPORARY");
  return parsed.data;
};
const envelope = <T>(schema: z.ZodType<T>) => z.object({ data: schema });
const address = z.object({ email: z.string() });
const addresses = address.array().default([]);
const subject = z.string().nullish().transform(value => value ?? "");
const summary = z.object({ id: ref, subject, snippet: z.string().optional(), latestMessageReceivedAt: z.string().nullish(), latestMessageSentAt: z.string().nullish() })
  .transform(({ id, ...rest }) => ({ ref: id, ...rest }));
const message = z.object({ id: ref, subject, text: z.string().nullish(), html: z.string().nullish(), contentNotRetained: z.boolean().optional(), from: address.nullish(), to: addresses, date: z.string().optional() })
  .transform(value => ({ ref: value.id, subject: value.subject, body: value.text ?? "", from: value.from?.email ?? "", to: value.to.map(v => v.email), date: value.date, ...((value.contentNotRetained || (value.text == null && value.html)) && { bodyUnavailable: true }) }));
const thread = z.object({ id: ref, accountId: ref.optional(), subject,
  messages: z.array(z.object({ id: ref, accountId: ref.optional(), threadId: ref.optional() }).loose()) });
const draft = z.object({ id: ref, version: ref, to: addresses, subject, text: z.string().nullish() })
  .transform(value => ({ ref: value.id, version: value.version, subject: value.subject, to: value.to.map(v => v.email), body: value.text ?? "" }));
const named = z.object({ id: ref, name: z.string() }).transform(value => ({ ref: value.id, name: value.name }));
const calendar = z.object({ id: ref, name: z.string(), primary: z.boolean().optional(), timezone: z.string().nullish(), readOnly: z.boolean().optional() })
  .transform(({ id, ...rest }) => ({ ref: id, ...rest }));
const eventDate = z.union([dateTime, z.iso.date()]);
const event = z.object({
  id: ref, calendarId: ref, title: z.string(), start: eventDate, end: eventDate, version: z.string().min(1).max(200).nullish(), timeZone: z.string().nullish(),
  description: z.string().nullish(), allDay: z.boolean().optional(), participants: addresses,
  conferencing: z.object({ url: httpsUrl.optional(), provider: z.enum(["google_meet", "teams", "other"]).optional() }).nullish(),
}).transform((value): EventDetail => ({
  ref: value.id, calendarRef: value.calendarId, ...(value.version && { version: value.version }), ...(value.timeZone && { timezone: value.timeZone }), title: value.title, start: value.start, end: value.end, allDay: value.allDay,
  description: value.description && !/<[^>]*>/.test(value.description) ? value.description : undefined,
  attendees: value.participants.map(v => v.email), meetingLink: value.conferencing?.url ?? null,
  meetingKind: value.conferencing?.provider === "google_meet" ? "meet" : value.conferencing?.provider === "teams" ? "teams" : undefined,
}));
const file = z.object({
  id: ref, accountId: ref, provider: z.enum(["google", "microsoft"]), name: z.string().min(1).max(500),
  kind: z.enum(["file", "folder"]), parentId: ref.nullable().default(null),
  mimeType: z.string().nullable().default(null), size: z.number().nonnegative().nullable().default(null),
  webUrl: httpsUrl.nullable().default(null), trashed: z.boolean().default(false),
}).transform(({ id, parentId, ...rest }) => ({ ref: id, parentRef: parentId, ...rest }));
const busyBlock = z.object({ start: dateTime, end: dateTime });
const freeSlot = z.object({ from: dateTime, to: dateTime }).transform(value => ({ start: value.from, end: value.to }));
const profilePayload = z.object({ profile: z.object({ _id: ref }) });
const providerScope = { mail: "email", calendar: "calendar", files: "files" } as const;

/** The only Office wire client. An injected transport is confined to contract tests. */
export class ZernioOfficeAdapter implements OfficeProvider {
  readonly id = "zernio" as const;
  constructor(private readonly transport?: Transport) {}

  private async call(credential: Credential, path: string, options: Options = {}): Promise<unknown> {
    const transport = this.transport ?? (OFFICE_LIVE_NETWORK ? globalThis.fetch : undefined);
    if (!transport) throw new OfficeProviderError("DISABLED");
    const url = new URL(api + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    try {
      const response = await transport(url.toString(), {
        method: options.method ?? "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${credential.secret}`, Accept: "application/json",
          ...(options.body && { "Content-Type": "application/json" }), ...options.headers },
        body: options.body && JSON.stringify(options.body),
      });
      switch (response.status) {
        case 204: return null;
        case 401: throw new OfficeProviderError("AUTH");
        case 403: throw new OfficeProviderError("UNAVAILABLE");
        case 404: throw new OfficeProviderError("NOT_FOUND");
        case 409: throw new OfficeProviderError("CONFLICT");
        case 412: {
          const payload = await response.json().catch(() => null);
          if (payload?.code === "account_scope_missing") throw new OfficeProviderError("RECONNECT_NEEDED");
          if (payload?.code === "draft_conflict") throw new OfficeProviderError("CONFLICT");
          throw new OfficeProviderError("UNAVAILABLE");
        }
        case 429: throw new OfficeProviderError("RATE_LIMITED");
      }
      if (!response.ok) throw new OfficeProviderError(response.status === 400 || response.status === 422 ? "INVALID_REQUEST" : "TEMPORARY");
      return await response.json();
    } catch (error) {
      if (error instanceof OfficeProviderError) throw error;
      throw new OfficeProviderError("TEMPORARY");
    }
  }

  async startConnect(credential: Credential, request: Parameters<OfficeProvider["startConnect"]>[1]) {
    const { existing, kind, platform, attemptId } = request;
    // The documented connect call takes one scope area per kind ("calendar"). No separate, incremental calendar write scope is documented, so a write grant is not requested.
    if (request.access === "write") throw new OfficeProviderError("UNAVAILABLE");
    const profileRef = existing?.profileRef ?? parse(profilePayload, await this.call(credential, "/profiles", {
      method: "POST", body: { name: "Harvest Office", externalId: attemptId },
      headers: { "Idempotency-Key": attemptId },
    })).profile._id;
    const handoff = parse(z.object({ handoff: z.object({ id: ref, url: httpsUrl, expiresAt: dateTime }) }), await this.call(credential, `/connect/${platform}`, {
      query: { profileId: profileRef, scopes: providerScope[kind], handoff: true, brandName: "Harvest", reconnectAccountId: existing?.ref },
    })).handoff;
    return { profileRef, handoffRef: handoff.id, url: handoff.url, expiresAt: new Date(handoff.expiresAt) };
  }

  async finishConnect(credential: Credential, request: Parameters<OfficeProvider["finishConnect"]>[1]): ReturnType<OfficeProvider["finishConnect"]> {
    const { profileRef, platform, kind, handoffRef, expectedRef } = request;
    const handoff = parse(z.object({
      id: ref, status: z.enum(["waiting", "opened", "connected", "failed", "expired"]), platform: z.string(),
      accounts: z.array(z.object({ id: ref, profileId: ref })).default([]),
    }), await this.call(credential, `/connect/handoffs/${segment(handoffRef)}`));
    if (handoff.id !== handoffRef || handoff.platform !== platform) return { state: "failed" };
    if (handoff.status === "waiting" || handoff.status === "opened") return { state: "pending" };
    const [account] = handoff.accounts;
    if (handoff.status !== "connected" || handoff.accounts.length !== 1 || account.profileId !== profileRef || (expectedRef && account.id !== expectedRef)) return { state: "failed" };
    const health = await this.health(credential, { ref: account.id, profileRef, kind, platform });
    return { state: "connected", accountRef: account.id, health };
  }

  async health(credential: Credential, account: OfficeAccount): Promise<Health> {
    const status = parse(z.object({
      accountId: ref, platform: z.string(), status: z.enum(["healthy", "warning", "error"]),
      disconnectionType: z.enum(["intentional", "unintentional"]).nullish(),
      tokenStatus: z.object({ valid: z.boolean().optional() }).optional(),
      permissions: z.object({ scopeAreas: z.record(z.string(), z.enum(["granted", "missing", "not_requested"])).optional() }).optional(),
      mailbox: z.object({ status: z.literal("unavailable") }).optional(),
    }), await this.call(credential, `/accounts/${segment(account.ref)}/health`));
    if (status.accountId !== account.ref || status.platform !== account.platform) throw new OfficeProviderError("NOT_FOUND");
    const grants = status.permissions?.scopeAreas?.[providerScope[account.kind]] === "granted" ? grant[account.kind] : 0;
    if (!grants || status.disconnectionType || status.tokenStatus?.valid === false) return { health: "reconnect_needed", grants };
    return { health: status.status === "error" || (status.mailbox && account.kind !== "files") ? "unavailable" : "healthy", grants };
  }

  async disconnect(credential: Credential, account: OfficeAccount) {
    await this.call(credential, `/accounts/${segment(account.ref)}`, { method: "DELETE" });
  }

  async thread(credential: Credential, account: OfficeAccount, threadRef: string): Promise<ThreadDetail> {
    const result = parse(envelope(thread), await this.call(credential, `/email/threads/${segment(threadRef)}`, { query: { accountId: account.ref } })).data;
    if (result.id !== threadRef || (result.accountId && result.accountId !== account.ref)
      || result.messages.some(row => (row.accountId && row.accountId !== account.ref) || (row.threadId && row.threadId !== threadRef))) {
      throw new OfficeProviderError("NOT_FOUND");
    }
    return { ref: result.id, subject: result.subject, messages: result.messages.map(row => parse(message, row)) };
  }

  async event(credential: Credential, account: OfficeAccount, eventRef: string, calendarRef?: string): Promise<EventDetail> {
    const result = parse(envelope(event), await this.call(credential, `/calendar/events/${segment(eventRef)}`, { query: { accountId: account.ref, calendarId: calendarRef } })).data;
    if (result.ref !== eventRef) throw new OfficeProviderError("NOT_FOUND");
    return result;
  }

  async file(credential: Credential, account: OfficeAccount, fileRef: string): Promise<FileDetail> {
    const { trashed, accountId, provider, ...result } = parse(envelope(file), await this.call(credential, `/files/${segment(fileRef)}`, { query: { accountId: account.ref } })).data;
    if (trashed || result.ref !== fileRef || accountId !== account.ref || provider !== account.platform) throw new OfficeProviderError("NOT_FOUND");
    return result;
  }

  async perform(credential: Credential, account: OfficeAccount, request: ProviderRequest): Promise<OfficeResult> {
    const accountId = account.ref;
    const query = { accountId };
    const get = (path: string, params?: Options["query"]) => this.call(credential, path, { query: { ...query, ...params } });
    const list = <T>(schema: z.ZodType<T>, payload: unknown) => {
      const result = parse(z.object({
        data: schema.array(), pagination: z.object({ nextCursor: cursorInput.nullish() }).optional(),
        stale: z.boolean().optional(), partial: z.boolean().optional(),
        meta: z.object({ filteredClientSide: z.string().array().optional() }).optional(),
      }), payload);
      if (result.stale) return { state: "temporarily_unavailable" } as const;
      return available({ items: result.data, nextCursor: result.pagination?.nextCursor ?? null,
        partial: Boolean(result.partial || result.meta?.filteredClientSide?.length) });
    };

    switch (request.action) {
      case "threads": {
        const { folderRef, search, cursor, limit } = request.input;
        return list(summary, await get("/email/threads", { folder: folderRef, searchQueryNative: search, cursor, limit }));
      }
      case "thread": return available(await this.thread(credential, account, request.input.threadRef));
      case "folders": return list(named, await get("/email/folders"));
      case "labels": return list(named, await get("/email/labels"));
      case "drafts": return list(draft, await get("/email/drafts", request.input));
      case "draft": return available(parse(envelope(draft), await get(`/email/drafts/${segment(request.input.draftRef)}`)).data);
      case "createDraft":
      case "updateDraft": {
        const { content } = request.input;
        const body = { accountId, to: content.to.map(email => ({ email })), subject: content.subject, text: content.body };
        const payload = request.action === "createDraft"
          ? await this.call(credential, "/email/drafts", { body, method: "POST", headers: { "Idempotency-Key": request.input.requestId } })
          : await this.call(credential, `/email/drafts/${segment(request.input.draftRef)}`, { body, method: "PATCH", headers: { "If-Match": request.input.version } });
        return available(parse(envelope(draft), payload).data);
      }
      case "deleteDraft":
        await this.call(credential, `/email/drafts/${segment(request.input.draftRef)}`, { method: "DELETE", query });
        return available({ deleted: true });
      case "calendars": return list(calendar, await get("/calendar/calendars"));
      case "events": {
        const { calendarRef, start, end, cursor, limit } = request.input;
        return list(event, await get("/calendar/events", { calendarId: calendarRef, from: start, to: end, cursor, limit, expandRecurring: true }));
      }
      case "event": return available(await this.event(credential, account, request.input.eventRef, request.input.calendarRef));
      case "freeBusy": {
        const { start, end, calendarRef } = request.input;
        const result = parse(envelope(z.object({ accountId: ref, busy: busyBlock.array().nullable(), error: z.unknown().optional(),
          calendars: z.array(z.object({ error: z.unknown().optional() })).optional() }).array()), await this.call(credential, "/calendar/free-busy", {
          method: "POST", body: { accounts: [{ accountId, calendarIds: calendarRef ? [calendarRef] : undefined }], from: start, to: end },
        })).data.find(row => row.accountId === accountId);
        return result?.busy && !result.error && !result.calendars?.some(row => row.error)
          ? available({ items: result.busy }) : { state: "temporarily_unavailable" };
      }
      case "availability": {
        const { start, end, durationMinutes } = request.input;
        const result = parse(envelope(z.object({ timeSlots: freeSlot.array() })), await this.call(credential, "/calendar/availability", {
          method: "POST", body: { participants: [{ accountId }], from: start, to: end, durationMinutes },
        })).data;
        return available({ items: result.timeSlots });
      }
      case "createEvent":
      case "updateEvent": {
        if (!OFFICE_CALENDAR_WRITE_ENABLED) return { state: "disabled" };
        const { calendarRef, event: change } = request.input;
        // Unverified against the live API: all-day, time zone and If-Match (event version) names follow the documented draft and file contracts.
        const body = { accountId, calendarId: calendarRef, start: change.start, end: change.end, allDay: change.allDay, timeZone: change.timezone, title: change.title,
          description: change.description?.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
          participants: change.attendees.map(email => ({ email })),
          ...(change.meeting && { conferencing: account.platform === "google" ? "google_meet" : "teams" }),
        };
        const payload = request.action === "createEvent"
          ? await this.call(credential, "/calendar/events", { method: "POST", body, headers: { "Idempotency-Key": request.input.requestId } })
          : await this.call(credential, `/calendar/events/${segment(request.input.eventRef)}`, { method: "PATCH", body, headers: { "If-Match": request.input.version } });
        return available(parse(envelope(event), payload).data);
      }
      case "deleteEvent":
        if (!OFFICE_CALENDAR_WRITE_ENABLED) return { state: "disabled" };
        await this.call(credential, `/calendar/events/${segment(request.input.eventRef)}`, { method: "DELETE", headers: { "If-Match": request.input.version },
          query: { ...query, calendarId: request.input.calendarRef },
        });
        return available({ deleted: true });
      case "files": {
        const { folderRef, search, cursor, limit } = request.input;
        const payload = await get("/files", { folderId: folderRef, q: search, cursor, limit });
        const result = list(file, payload);
        if (result.state !== "available") return result;
        if (result.data.items.some(row => row.accountId !== accountId || row.provider !== account.platform)) throw new OfficeProviderError("NOT_FOUND");
        return available({ ...result.data, items: result.data.items.filter(row => !row.trashed).map(({ ref, name, kind, parentRef, mimeType, size, webUrl }) =>
          ({ ref, name, kind, parentRef, mimeType, size, webUrl })) });
      }
      case "file": return available(await this.file(credential, account, request.input.fileRef));
      case "preview": {
        const result = await this.file(credential, account, request.input.fileRef);
        return result.webUrl ? available({ url: result.webUrl }) : { state: "unavailable" };
      }
      case "drives":
      case "downloadLink": return { state: "unavailable" };
      case "picker": {
        if (account.platform !== "google") return { state: "unavailable" };
        const result = parse(envelope(z.object({ id: ref, url: httpsUrl, expiresAt: dateTime })), await this.call(credential, "/files/picker-sessions", {
          method: "POST", body: { accountId, multiselect: false },
        })).data;
        return available({ mode: "hosted", url: result.url, expiresAt: result.expiresAt });
      }
    }
  }
}
