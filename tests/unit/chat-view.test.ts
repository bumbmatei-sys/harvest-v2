import { describe, expect, it } from "vitest";
import { channelLinks, mergeChatMessages, plainChatBody, type ChatMessage } from "../../src/lib/chat-view";

const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", channelId: "c", authorId: "u1", authorName: "Ana", clientId: "k", parentId: null, seq: "1", rev: "1", body: "hi", mentionIds: [], mentions: [],
  createdAt: "2026-11-18T00:00:00Z", editedAt: null, deletedAt: null, deletedKind: null, heldAt: null, pinnedAt: null, replyCount: 0, reactions: [], ...over,
});

describe("channelLinks", () => {
  it("lists distinct links newest first and trims trailing punctuation", () => {
    const links = channelLinks([
      message({ id: "a", seq: "1", body: "see https://a.example/x, and https://b.example." }),
      message({ id: "b", seq: "2", body: "again https://a.example/x" }),
    ]);
    expect(links).toEqual(["https://a.example/x", "https://b.example"]);
  });
  it("skips deleted and held messages and caps the list", () => {
    expect(channelLinks([message({ body: "https://gone.example", deletedAt: "x" }), message({ id: "h", seq: "2", body: "https://held.example", heldAt: "x" })])).toEqual([]);
    const many = Array.from({ length: 60 }, (_, index) => message({ id: String(index), seq: String(index + 1), body: `https://e${index}.example` }));
    expect(channelLinks(many)).toHaveLength(50);
  });
});

describe("plainChatBody", () => {
  it("replaces validated mention tokens with names and drops unvalidated tokens", () => {
    expect(plainChatBody(message({ body: "hi <@u2> and <@u9>", mentionIds: ["u2"], mentions: [{ id: "u2", name: "Bea" }] }))).toBe("hi @Bea and ");
  });
});

describe("mergeChatMessages", () => {
  it("keeps the newer revision per id and orders by sequence", () => {
    const merged = mergeChatMessages([message({ id: "a", seq: "2", rev: "5", body: "new" })], [message({ id: "a", seq: "2", rev: "3", body: "old" }), message({ id: "b", seq: "1", rev: "1" })]);
    expect(merged.map(item => item.id)).toEqual(["b", "a"]);
    expect(merged[1].body).toBe("new");
  });
});
