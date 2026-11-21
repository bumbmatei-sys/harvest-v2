import { describe, expect, it, vi } from "vitest";
import { officeScreensEnabled } from "../../src/server/office-gate";
import { mailboxLabel, parseRecipients, replySubject, senderAddress, threadTime, validEmail, type ThreadSummary } from "../../src/lib/office/mail";

vi.mock("server-only", () => ({}));
const marker = { ref: "t", read: false, starred: false, contactId: null };
const thread = (extra: Partial<ThreadSummary>): ThreadSummary => ({ ref: "t", subject: "s", marker, ...extra });

describe("office mail client helpers", () => {
  it("reads the mailbox out of a sender string", () => {
    expect(senderAddress("Pat Lee <pat@example.test>")).toBe("pat@example.test");
    expect(senderAddress("  pat@example.test ")).toBe("pat@example.test");
    expect(senderAddress("")).toBe("");
  });
  it("adds Re: once", () => {
    expect(replySubject("Planning")).toBe("Re: Planning");
    expect(replySubject("Re: Planning")).toBe("Re: Planning");
    expect(replySubject(" RE: Planning ")).toBe("RE: Planning");
    expect(replySubject("")).toBe("Re:");
  });
  it("splits recipients on commas, semicolons and spaces and validates each address", () => {
    expect(parseRecipients("a@b.co, c@d.org;  e@f.net\ng@h.io")).toEqual(["a@b.co", "c@d.org", "e@f.net", "g@h.io"]);
    expect(parseRecipients("  ")).toEqual([]);
    expect(validEmail("a@b.co")).toBe(true);
    for (const bad of ["a", "a@b", "a b@c.de", "<a@b.co>", "@b.co"]) expect(validEmail(bad), bad).toBe(false);
  });
  it("shows the received time, then the sent time, and never invents one", () => {
    expect(threadTime(thread({ latestMessageReceivedAt: "2026-11-20T10:00:00Z", latestMessageSentAt: "2026-11-19T10:00:00Z" }))).toBe("2026-11-20T10:00:00Z");
    expect(threadTime(thread({ latestMessageReceivedAt: null, latestMessageSentAt: "2026-11-19T10:00:00Z" }))).toBe("2026-11-19T10:00:00Z");
    expect(threadTime(thread({}))).toBeNull();
  });
  it("names both mailbox providers outside the message catalogue", () => {
    expect(mailboxLabel).toEqual({ google: "Gmail", microsoft: "Outlook" });
  });
  it("keeps the screens behind the same closed gate as the routes", () => {
    expect(officeScreensEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(officeScreensEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(officeScreensEnabled({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(false);
    expect(officeScreensEnabled({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
  });
});
