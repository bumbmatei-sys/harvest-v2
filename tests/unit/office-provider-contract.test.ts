import { describe, expect, it, vi } from "vitest";
import { FakeMailProvider } from "../../src/server/mail/fake-provider";
import { FakeCalendarProvider } from "../../src/server/calendar/fake-provider";
import { FakeFilesProvider } from "../../src/server/files-provider/fake-provider";
import { getMailProvider } from "../../src/server/mail/registry";
import { getCalendarProvider } from "../../src/server/calendar/registry";
import { getFilesProvider } from "../../src/server/files-provider/registry";
import type { MailProvider } from "../../src/server/mail/port";
import type { CalendarProvider } from "../../src/server/calendar/port";
import type { FilesProvider } from "../../src/server/files-provider/port";
const c = { secret: "fake-credential" }, q = { accountRef: "account-1" };
// Exported contract installers: any enabled adapter must pass these against synthetic fixtures.
export function mailContract(factory: () => MailProvider) {
  it("mail search, thread read, reply/forward, labels and drafts", async () => {
    const p = factory(), write = { ...q, idempotencyKey: "a", to: ["test@example.test"], subject: "Test", body: "Synthetic" };
    const sent = await p.send(c, write); expect(await p.send(c, write)).toEqual(sent);
    const threads = await p.listThreads(c, { ...q, search: "Test" }); expect(threads.items).toHaveLength(1);
    const messages = await p.listMessages(c, { ...q, threadRef: threads.items[0].ref }); expect(messages.items[0].ref).toBe(sent.ref);
    await p.setLabels(c, q.accountRef, sent.ref, ["archive"]); expect((await p.listMessages(c, { ...q, threadRef: threads.items[0].ref })).items[0].labelRefs).toEqual(["archive"]);
    await p.reply(c, { ...write, idempotencyKey: "b", messageRef: sent.ref }); await p.forward(c, { ...write, idempotencyKey: "c", messageRef: sent.ref });
    expect((await p.listLabels(c, q.accountRef)).length).toBeGreaterThan(0);
    const draft = await p.saveDraft(c, write); expect((await p.listDrafts(c, q)).items).toEqual([draft]); await p.deleteDraft(c, q.accountRef, draft.ref); expect((await p.listDrafts(c, q)).items).toEqual([]);
  });
}
export function calendarContract(factory: () => CalendarProvider) {
  it("calendar CRUD, RSVP, meeting link and complementary free time", async () => {
    const p = factory(), input = { ...q, idempotencyKey: "a", title: "Test", attendees: [], start: "2026-11-16T10:00:00Z", end: "2026-11-16T11:00:00Z", createMeetingLink: true };
    const e = await p.createEvent(c, input); expect(await p.createEvent(c, input)).toEqual(e); expect(e.meetingLink).toBeTruthy();
    expect(await p.findFreeTime(c, q.accountRef, { start: "2026-11-16T09:00:00Z", end: "2026-11-16T12:00:00Z" })).toHaveLength(2);
    await p.rsvp(c, q.accountRef, e.ref, "accepted"); expect((await p.listEvents(c, q)).items[0].rsvp).toBe("accepted");
    expect((await p.updateEvent(c, { ...input, eventRef: e.ref, title: "Updated" })).title).toBe("Updated"); await p.deleteEvent(c, q.accountRef, e.ref); expect((await p.listEvents(c, q)).items).toEqual([]);
  });
}
export function filesContract(factory: () => FilesProvider) {
  it("files only visible picks/uploads, search, defensive bytes and share", async () => {
    const p = factory(); expect((await p.listFiles(c, q)).items).toEqual([]);
    await expect(p.download(c, q.accountRef, "unpicked")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const input = { ...q, name: "Test", mimeType: "text/plain", bytes: new Uint8Array([1,2]), idempotencyKey: "a" };
    const f = await p.upload(c, input); expect(await p.upload(c, input)).toEqual(f); input.bytes[0] = 9; const bytes = await p.download(c, q.accountRef, f.ref); expect(bytes[0]).toBe(1); bytes[0] = 8; expect((await p.download(c, q.accountRef, f.ref))[0]).toBe(1);
    expect((await p.listFiles(c, { ...q, search: "Test" })).items).toEqual([f]); expect((await p.share(c, q.accountRef, f.ref, { recipient: "test@example.test", access: "read" })).ref).toBeTruthy();
  });
}
describe("office fake contracts", () => {
  mailContract(() => new FakeMailProvider()); calendarContract(() => new FakeCalendarProvider()); filesContract(() => new FakeFilesProvider());
  it("caps are per mailbox/day and retries do not consume quota", async () => { let day = new Date("2026-11-16T12:00:00Z"); const p = new FakeMailProvider(["account-1", "account-2"], 1, () => day), input = { ...q, idempotencyKey: "a", to: ["test@example.test"], subject: "Test", body: "Body", scheduledFor: "2026-11-17T12:00:00Z" }; await p.send(c, input); await p.send(c, input); expect((await p.getSendCap(c, q.accountRef)).remaining).toBe(0); await expect(p.send(c, { ...input, idempotencyKey: "b" })).rejects.toMatchObject({ code: "RATE_LIMITED" }); expect((await p.getSendCap(c, "account-2")).remaining).toBe(1); day = new Date("2026-11-17T00:00:00Z"); expect((await p.getSendCap(c, q.accountRef)).remaining).toBe(1); });
  it("fake credentials/account bounds and pagination reject invalid input", async () => { for (const p of [new FakeMailProvider(),new FakeCalendarProvider(),new FakeFilesProvider()]) { await expect(p.listAccounts({ secret: "bad" })).rejects.toMatchObject({ code: "AUTH" }); } const p = new FakeFilesProvider(); await expect(p.listFiles(c, { accountRef: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" }); await expect(p.listFiles(c, { ...q, limit: -1 })).rejects.toMatchObject({ code: "INVALID_REQUEST" }); });
  it("registries default disabled and adapters make zero network calls for every method", async () => { const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN")); try { for (const p of [getMailProvider(),getCalendarProvider(),getFilesProvider()]) { for (const name of Object.keys(p)) { const fn = (p as unknown as Record<string, unknown>)[name]; if (typeof fn === "function") await expect(fn()).rejects.toMatchObject({ code: "DISABLED" }); } } expect(spy).not.toHaveBeenCalled(); expect(getMailProvider("test")).toBeInstanceOf(FakeMailProvider); expect(getCalendarProvider("test")).toBeInstanceOf(FakeCalendarProvider); expect(getFilesProvider("test")).toBeInstanceOf(FakeFilesProvider); } finally { spy.mockRestore(); } });
});

it("scheduled send retry after due time retains original result", async () => { let now = new Date("2026-11-16T00:00:00Z"); const p = new FakeMailProvider(undefined, 1, () => now); const input = { ...q, idempotencyKey: "due", to: ["test@example.test"], subject: "Test", body: "Test", scheduledFor: "2026-11-17T00:00:00Z" }; const result = await p.send(c, input); now = new Date("2026-11-18T00:00:00Z"); expect(await p.send(c, input)).toEqual(result); });
it("upload cannot overwrite a picked provider reference", async () => { const p = new FakeFilesProvider(undefined, [{ ...q, file: { ref: "file-1", name: "Picked", mimeType: "text/plain", size: 1 }, bytes: new Uint8Array([7]) }]); const uploaded = await p.upload(c, { ...q, name: "New", mimeType: "text/plain", bytes: new Uint8Array([1]), idempotencyKey: "new" }); expect(uploaded.ref).not.toBe("file-1"); expect((await p.download(c, q.accountRef, "file-1"))[0]).toBe(7); });
