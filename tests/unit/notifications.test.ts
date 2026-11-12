import { describe, expect, it } from "vitest";
import { notificationHref, prefForKind, summaryKey, unreadDisplay, type NotificationView } from "@/lib/notifications";

// C15a: pure notification rules.
const item = (over: Partial<NotificationView>): NotificationView => ({ id: "n", kind: "reply", targetType: "post", postId: "p1", actorName: "Ana", count: 1, detail: {}, read: false, createdAt: "", ...over });

describe("unreadDisplay", () => {
  it("shows exact counts up to 99 and caps above", () => {
    expect(unreadDisplay(0)).toEqual({ value: 0, capped: false });
    expect(unreadDisplay(99)).toEqual({ value: 99, capped: false });
    expect(unreadDisplay(100)).toEqual({ value: 99, capped: true });
    expect(unreadDisplay(-3)).toEqual({ value: 0, capped: false });
  });
});

describe("summaryKey", () => {
  it("picks the message per kind and detail", () => {
    expect(summaryKey(item({ kind: "reply" }))).toBe("reply");
    expect(summaryKey(item({ kind: "like", count: 1 }))).toBe("like");
    expect(summaryKey(item({ kind: "like", count: 4 }))).toBe("likeMany");
    expect(summaryKey(item({ kind: "like", count: 1, targetType: "comment" }))).toBe("likeReply");
    expect(summaryKey(item({ kind: "like", count: 2, targetType: "comment" }))).toBe("likeReplyMany");
    expect(summaryKey(item({ kind: "application", detail: { status: "approved" } }))).toBe("applicationApproved");
    expect(summaryKey(item({ kind: "application", detail: { status: "info_requested" } }))).toBe("applicationInfo");
    expect(summaryKey(item({ kind: "application", detail: { status: "declined" } }))).toBe("applicationDeclined");
    expect(summaryKey(item({ kind: "held_decision", detail: { decision: "approve" } }))).toBe("heldApproved");
    expect(summaryKey(item({ kind: "held_decision", detail: { decision: "reject" } }))).toBe("heldRejected");
    expect(summaryKey(item({ kind: "appeal_decision", detail: { decision: "approve" } }))).toBe("appealApproved");
    expect(summaryKey(item({ kind: "host_queue", count: 3 }))).toBe("hostQueueMany");
    expect(summaryKey(item({ kind: "announcement" }))).toBe("announcement");
  });
});

describe("prefForKind", () => {
  it("maps kinds to the switch that silences them", () => {
    expect(prefForKind("reply")).toBe("replies");
    expect(prefForKind("thread_reply")).toBe("replies");
    expect(prefForKind("like")).toBe("likes");
    expect(prefForKind("announcement")).toBe("announcements");
    expect(prefForKind("warning")).toBeNull();
  });
});

describe("notificationHref", () => {
  it("links to the post, the queue, the forum or the account page", () => {
    expect(notificationHref("grace", item({}))).toBe("/communities/grace/posts/p1");
    expect(notificationHref("grace", item({ kind: "host_queue", postId: null }))).toBe("/communities/grace/moderation");
    expect(notificationHref("grace", item({ kind: "held_decision", detail: { decision: "reject" } }))).toBe("/communities/grace/forum");
    expect(notificationHref("grace", item({ kind: "held_decision", detail: { decision: "approve" } }))).toBe("/communities/grace/posts/p1");
    expect(notificationHref("grace", item({ kind: "appeal_decision", postId: null }))).toBe("/account/communities");
    expect(notificationHref("grace", item({ kind: "warning", postId: null }))).toBe("/communities/grace/forum");
  });
});
