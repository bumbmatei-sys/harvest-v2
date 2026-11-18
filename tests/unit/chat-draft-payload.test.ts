import { describe, expect, it } from "vitest";
import { chatDraftPayload } from "../../src/components/communities/chat/chat-composer";

const ana = { id: "u-ana", name: "Ana" }, anabel = { id: "u-anabel", name: "Anabel Lee" };

describe("chatDraftPayload", () => {
  it("turns each chosen mention into a token and lists its id once", () => {
    expect(chatDraftPayload({ text: " hi @Ana and @Ana ", mentions: [ana] })).toEqual({ body: "hi <@u-ana> and <@u-ana>", mention_ids: ["u-ana"] });
  });
  it("matches the longest name first so a shorter prefix does not split it", () => {
    expect(chatDraftPayload({ text: "@Anabel Lee and @Ana", mentions: [ana, anabel] })).toEqual({ body: "<@u-anabel> and <@u-ana>", mention_ids: ["u-anabel", "u-ana"] });
  });
  it("leaves an edited-away or partial mention as plain text and sends no id for it", () => {
    expect(chatDraftPayload({ text: "hello @Anaconda", mentions: [ana] })).toEqual({ body: "hello @Anaconda", mention_ids: [] });
    expect(chatDraftPayload({ text: "mail me@Ana", mentions: [ana] })).toEqual({ body: "mail me@Ana", mention_ids: [] });
  });
  it("escapes regular expression characters in names", () => {
    const odd = { id: "u-x", name: "J. (Jo) O'Neil+" };
    expect(chatDraftPayload({ text: "ping @J. (Jo) O'Neil+!", mentions: [odd] })).toEqual({ body: "ping <@u-x>!", mention_ids: ["u-x"] });
  });
});
