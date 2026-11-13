import { describe, expect, it } from "vitest";
import { renderEmail, safeTitle, type EmailItem, type EmailJob } from "@/lib/community-email";
import { verifyUnsubscribe } from "@/lib/community-email-token";

const secret = "a-long-enough-test-secret-value", origin = "http://127.0.0.1:3100", now = 1_800_000_000_000;
const item = (over: Partial<EmailItem> = {}): EmailItem => ({ kind: "warning", targetType: "warning", count: 1, actorName: null, postTitle: null, postId: null, detail: {}, ...over });
const job = (over: Partial<EmailJob> = {}): EmailJob => ({ id: "d1", kind: "instant", to: "m@example.test", name: "Mia", tenantId: "t1", communityId: "c1", recipientId: "u1",
  communityName: "Grace Group", communitySlug: "grace", hasMembership: true, items: [item()], ...over });
const unsubUrl = (text: string) => text.match(/http:\/\/127\.0\.0\.1:3100\/communities\/unsubscribe#token=[\w.-]+/)![0];

describe("safeTitle", () => {
  it("is one line, without control or direction-override characters, and at most 80 characters", () => {
    expect(safeTitle("Hello\n\tthere‮ world\u0000")).toBe("Hello there world");
    expect(safeTitle("x".repeat(200))).toHaveLength(80);
    expect(safeTitle("x".repeat(200)).endsWith("…")).toBe(true);
    expect(safeTitle(null)).toBe("");
  });
  it("neutralises links, addresses and domains, but keeps ordinary words and dates", () => {
    expect(safeTitle("Verify your account at https://evil.example/login now")).toBe("Verify your account at [link removed] now");
    expect(safeTitle("see WWW.Evil.Example/x or evil.com/path")).toBe("see [link removed] or [link removed]");
    expect(safeTitle("mail bob@evil.example today")).toBe("mail [link removed] today");
    expect(safeTitle("javascript:alert(1) and tel:+4075")).toBe("[link removed] and [link removed]");
    expect(safeTitle("Pay at give.church now")).toBe("Pay at [link removed] now");
    expect(safeTitle("Prayer for Q1. Planning, e.g. 3.5 hours and the Smith family")).toBe("Prayer for Q1. Planning, e.g. 3.5 hours and the Smith family");
  });
});

describe("renderEmail", () => {
  it("renders an instant email with the community, a summary line and a link, and no HTML", () => {
    const mail = renderEmail(job(), { origin, secret, now });
    expect(mail.subject).toBe("Grace Group: You received a warning from the hosts");
    expect(mail.text).toContain("Hello Mia,");
    expect(mail.text).toContain("• You received a warning from the hosts");
    expect(mail.text).toContain("http://127.0.0.1:3100/communities/grace/forum");
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });
  it("adds a trimmed post title and a link to the post", () => {
    const mail = renderEmail(job({ items: [item({ kind: "reply", targetType: "comment", actorName: "Ana", postTitle: `A${"b".repeat(200)}`, postId: "p1" })] }), { origin, secret, now });
    expect(mail.text).toContain("Ana replied to your post");
    expect(mail.text).toContain("/communities/grace/posts/p1");
    expect(mail.text).not.toContain("b".repeat(81));
  });
  it("renders a digest with a count in the subject and one block per item", () => {
    const mail = renderEmail(job({ kind: "digest", items: [item({ kind: "reply", targetType: "comment", postId: "p1" }), item({ kind: "like", targetType: "post", count: 3, postId: "p2" })] }), { origin, secret, now });
    expect(mail.subject).toBe("Grace Group: 2 updates for you");
    expect(mail.text.match(/^• /gm)).toHaveLength(2);
    expect(mail.text).toContain("and 2 others liked your post");
  });
  it("carries a working unsubscribe link and the one-click headers for members", () => {
    const mail = renderEmail(job(), { origin, secret, now });
    const token = unsubUrl(mail.text).split("#token=")[1];
    expect(verifyUnsubscribe(secret, token, now)).toEqual({ tenantId: "t1", communityId: "c1", userId: "u1" });
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/127\.0\.0\.1:3100\/api\/communities\/unsubscribe\?token=[\w.-]+>$/);
  });
  it("has no unsubscribe link or headers for a one-time message to someone without a membership", () => {
    const mail = renderEmail(job({ hasMembership: false, items: [item({ kind: "application", targetType: "application", detail: { status: "approved" } })] }), { origin, secret, now });
    expect(mail.subject).toContain("Your application was approved");
    expect(mail.headers).toEqual({});
    expect(mail.text).not.toContain("unsubscribe");
    expect(mail.text).toContain("one-time message");
  });
  it("sends a held-decision to the forum and an appeal decision to the account page", () => {
    expect(renderEmail(job({ items: [item({ kind: "appeal_decision", targetType: "appeal", detail: { decision: "approve" } })] }), { origin, secret, now }).text).toContain("http://127.0.0.1:3100/account/communities");
  });
});
