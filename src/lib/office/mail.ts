// Browser side of the Office routes for personal mail (docs/acceptance/office-server.md). Types mirror the route responses; nothing here validates: the server
// is the only authority. Mail content is fetched live, held in component state only and never written to browser storage.
export type Health = "healthy" | "unavailable" | "reconnect_needed";
export type OfficePlatform = "google" | "microsoft";
export type Capability = "available" | "unavailable" | "disabled";
export type OfficeConnection = {
  id: string; kind: "mail" | "calendar" | "files"; platform: OfficePlatform | null; health: Health; grants: number; noticeVersion: number | null;
  capabilities: Record<string, Capability>; send?: "disabled";
};
export type OfficeOverview = { notice: { key: string; version: number }; connections: OfficeConnection[] };
export type Marker = { ref: string; read: boolean; starred: boolean; contactId: string | null };
export type ThreadSummary = { ref: string; subject: string; snippet?: string; latestMessageReceivedAt?: string | null; latestMessageSentAt?: string | null; marker: Marker };
export type Message = { ref: string; subject: string; body: string; from: string; to: string[]; date?: string; bodyUnavailable?: boolean };
export type ThreadDetail = { ref: string; subject: string; messages: Message[]; marker: Marker };
export type NamedRef = { ref: string; name: string };
export type Draft = { ref: string; version?: string; subject: string; to: string[]; body: string };
export type DraftContent = { to: string[]; subject: string; body: string };
export type Page<T> = { items: T[]; nextCursor?: string | null; partial?: boolean };
export type Failure = "unavailable" | "reconnect_needed" | "temporarily_unavailable" | "disabled";
export type Result<T> = { state: "available"; data: T } | { state: Failure };
export type Pending = { state: "pending"; attemptId: string; url: string | null; expiresAt: string };
export type Connected = { state: "connected"; connection: OfficeConnection };

export class OfficeApiError extends Error {
  constructor(readonly status: number) { super(String(status)); }
  /** One neutral 404 covers a closed gate, a missing record, another person's connection and a role without access. */
  get unavailable() { return this.status === 404; }
  get conflict() { return this.status === 409; }
  get signedOut() { return this.status === 401; }
}

async function call<T>(tenantId: string, init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${tenantId}/office`, { method: init.method, signal: init.signal, cache: "no-store",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new OfficeApiError(0);
  }
  if (!response.ok) throw new OfficeApiError(response.status);
  return await response.json() as T;
}

/** Every request names the Harvest connection id; the server resolves the mailbox from the signed-in person, never from the browser. */
export const mailApi = (tenantId: string) => {
  const run = <T,>(action: string, connectionId: string | undefined, input: unknown, signal?: AbortSignal) =>
    call<Result<T>>(tenantId, { method: "POST", signal, body: { action, ...(connectionId ? { connectionId } : {}), input } });
  return {
    overview: (signal?: AbortSignal) => call<OfficeOverview>(tenantId, { method: "GET", signal }),
    startConnect: (platform: OfficePlatform, noticeVersion: number, connectionId?: string) =>
      call<Pending | { state: Failure }>(tenantId, { method: "POST", body: { action: "startConnect", ...(connectionId ? { connectionId } : {}), input: { kind: "mail", platform, noticeVersion } } }),
    finishConnect: (attemptId: string) => call<Connected | { state: "pending" | "failed" }>(tenantId, { method: "POST", body: { action: "finishConnect", input: { attemptId } } }),
    health: (connectionId: string) => call<{ state: string }>(tenantId, { method: "POST", body: { action: "health", connectionId, input: {} } }),
    disconnect: (connectionId: string) => call<{ state: string }>(tenantId, { method: "POST", body: { action: "disconnect", connectionId, input: {} } }),
    folders: (id: string, signal?: AbortSignal) => run<Page<NamedRef>>("folders", id, {}, signal),
    threads: (id: string, input: { cursor?: string; folderRef?: string; search?: string; limit?: number }, signal?: AbortSignal) => run<Page<ThreadSummary>>("threads", id, input, signal),
    thread: (id: string, threadRef: string, signal?: AbortSignal) => run<ThreadDetail>("thread", id, { threadRef }, signal),
    marker: (id: string, input: { threadRef: string; read?: boolean; starred?: boolean; contactId?: string | null }) => run<Marker>("marker", id, input),
    drafts: (id: string, cursor?: string, signal?: AbortSignal) => run<Page<Draft>>("drafts", id, cursor ? { cursor } : {}, signal),
    draft: (id: string, draftRef: string, signal?: AbortSignal) => run<Draft>("draft", id, { draftRef }, signal),
    createDraft: (id: string, content: DraftContent, requestId: string) => run<Draft>("createDraft", id, { content, requestId }),
    updateDraft: (id: string, draftRef: string, version: string, content: DraftContent) => run<Draft>("updateDraft", id, { draftRef, version, content }),
    deleteDraft: (id: string, draftRef: string) => run<{ deleted: true }>("deleteDraft", id, { draftRef }),
  };
};
export type MailApi = ReturnType<typeof mailApi>;

/** Mailbox provider names for the account chip and the connect buttons. Product names live here and in the logo registry, never in the message catalogue. */
export const mailboxLabel: Record<OfficePlatform, string> = { google: "Gmail", microsoft: "Outlook" };
export const platformName: Record<OfficePlatform, "gmail" | "outlook"> = { google: "gmail", microsoft: "outlook" };

/** Newest activity on a thread, for the row time. */
export const threadTime = (thread: ThreadSummary) => thread.latestMessageReceivedAt ?? thread.latestMessageSentAt ?? null;
/** The first mailbox in a sender string such as `Name <a@b.c>`; plain addresses pass through. */
export function senderAddress(from: string) { const match = /<([^<>\s]+)>/.exec(from); return (match ? match[1] : from).trim(); }
/** `Re: ` once, whatever the subject already carries. */
export const replySubject = (subject: string) => /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`.trim();
/** Splits a recipient field on commas, semicolons and whitespace and drops empties. */
export const parseRecipients = (text: string) => text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
export const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
