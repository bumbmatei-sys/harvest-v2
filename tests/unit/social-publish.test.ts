import { describe, expect, it } from "vitest";
import { platformCharacterCounters } from "../../src/lib/social/characters";
import { platformCapabilities, socialPlatforms } from "../../src/lib/social/platforms";
import { mediaFileErrors, mediaRulesFor, platformMediaRules } from "../../src/lib/social/media";
import { destinationErrors, inspectAttachments } from "../../src/server/social/compose-validation";
import { nextPostingSlot } from "../../src/server/social/posting-schedules";
import { FakeProvider } from "../../src/server/social/fake-provider";
import { ZernioAdapter } from "../../src/server/social/zernio-adapter";

const inventory = ["twitter", "instagram", "facebook", "linkedin", "tiktok", "youtube", "pinterest", "reddit", "bluesky", "threads", "googlebusiness",
  "telegram", "snapchat", "whatsapp", "discord", "slack", "wordpress", "shopify", "wix", "webflow", "rcs", "imessage", "line", "wechat", "sms"] as const;
const counts = {
  twitter: [27, 280], instagram: [112, 2200], facebook: [112, 63206], linkedin: [112, 3000], tiktok: [112, 2200], youtube: [112, 5000],
  pinterest: [112, 800], reddit: [112, 40000], bluesky: [112, 300], threads: [112, 500], googlebusiness: [112, 1500],
  telegram: [112, 4096], snapchat: [112, null], whatsapp: [112, null], discord: [112, 2000], slack: [112, 40000],
  wordpress: [112, null], shopify: [112, null], wix: [112, null], webflow: [112, null], rcs: [112, null],
  imessage: [112, null], line: [112, null], wechat: [112, null], sms: [112, null],
} as const;
const url = `https://a.co/${"a".repeat(95)}`;

describe("public platform inventory", () => {
  it("maps the audited enum through fake and mock adapter and drops other product families", async () => {
    expect(socialPlatforms).toEqual(inventory);
    const accounts = inventory.map(platform => ({ accountRef: "fake-" + platform, platform, displayName: platform }));
    const cred = { secret: "fake-credential" };
    const fake = new FakeProvider({ accounts });
    const adapter = new ZernioAdapter({ fetch: async () => Response.json({
      accounts: [...accounts.map(account => ({ ...account, _id: account.accountRef })), { _id: "ads", platform: "metaads" }, { _id: "unknown", platform: "unknown" }],
    }) });
    expect(await fake.listAccounts(cred)).toEqual(accounts);
    expect(await adapter.listAccounts(cred)).toEqual(accounts);
  });
  it.each(inventory)("%s counts an emoji, a mention, a line break and a long URL", platform => {
    const [used, limit] = counts[platform];
    const result = platformCharacterCounters[platform](`🙂@a\n${url}`);
    expect(result).toMatchObject({ used: platform === "twitter" ? used + 1 : used, limit, remaining: limit === null ? null : limit - used - Number(platform === "twitter") });
    expect(platformCharacterCounters[platform](`🙂@a\r\n${url}`)).toEqual(result);
    expect(platformCapabilities[platform]).toHaveProperty("postTypes.article");
    expect(platformMediaRules[platform]).toHaveProperty("maxItems");
    if (platformCapabilities[platform].postTypes.post === "unavailable") {
      expect(destinationErrors(platform, "post", "test", undefined, []).errors).toContain("UNSUPPORTED_POST_TYPE");
    }
  });
  it("counts a family as one Bluesky grapheme and rejects excessive UTF-8 bytes separately", () => {
    const emoji = "👨‍👩‍👧‍👦";
    expect(platformCharacterCounters.bluesky(emoji)).toMatchObject({ used: 1, remaining: 299 });
    expect(destinationErrors("bluesky", "post", emoji.repeat(121), undefined, []).errors).toContain("TEXT_BYTE_LIMIT_EXCEEDED");
  });
  it("accounts for transformed X URLs, punctuation and NFC and selects the correct contextual limits", () => {
    expect(platformCharacterCounters.twitter(`e\u0301 (${url}).`).used).toBe(28);
    expect(platformCharacterCounters.twitter("test", { premium: true }).limit).toBe(25000);
    expect(platformCharacterCounters.telegram("test", { media: "video" }).limit).toBe(1024);
    expect(platformCharacterCounters.tiktok("test", { media: "image" }).limit).toBe(4000);
    expect(platformCharacterCounters.facebook("x", { type: "story" }).remaining).toBe(-1);
  });
});
describe("attachment rules", () => {
  const jpeg = { id: "img", mime: "image/jpeg", size: 100, width: 1080, height: 1080 };
  const reel = { id: "vid", mime: "video/mp4", size: 100, durationMs: 3000, width: 1080, height: 1920 };
  it.each([
    ["twitter", { ...jpeg, mime: "image/gif" }, "gif"],
    ["linkedin", { ...jpeg, mime: "application/pdf" }, "document"],
    ["instagram", jpeg, "image"],
    ["youtube", reel, "video"],
  ] as const)("%s accepts its documented %s attachment", (platform, media, kind) => {
    const checked = inspectAttachments(platform, "post", undefined, [{ fileId: media.id }], new Map([[media.id, media]]));
    expect(checked).toMatchObject({ results: [{ accepted: true, kind }] });
  });
  it("accepts Instagram mixed media and reports X mixed media as unavailable", () => {
    const fileMap = new Map([[jpeg.id, jpeg], [reel.id, reel]]), files = [{ fileId: jpeg.id }, { fileId: reel.id }];
    expect(inspectAttachments("instagram", "post", undefined, files, fileMap).results.every(item => item.accepted)).toBe(true);
    expect(inspectAttachments("twitter", "post", undefined, files, fileMap).issues).toContain("MEDIA_MIXED_NOT_ALLOWED");
  });
  it("enforces size, duration, aspect ratio and reported per-item format", () => {
    const rule = mediaRulesFor("facebook", "post", "reel")!.files.video!;
    const boundary = { ...reel, size: rule.maxBytes, durationMs: 60000 };
    expect(mediaFileErrors(boundary, rule)).toEqual([]);
    expect(mediaFileErrors({ ...boundary, width: 1920, durationMs: 60001, size: rule.maxBytes + 1 }, rule))
      .toEqual(["MEDIA_TOO_LARGE", "MEDIA_TOO_LONG", "MEDIA_WRONG_ASPECT_RATIO"]);
    expect(mediaFileErrors({ ...boundary, durationMs: 2999 }, rule)).toContain("MEDIA_TOO_SHORT");
    expect(mediaFileErrors(jpeg, rule)).toEqual(["MEDIA_WRONG_TYPE"]);
  });
  it("distinguishes the typed story and short with an account-specific video variant", () => {
    const files = new Map([[reel.id, reel]]), attachments = [{ fileId: reel.id }];
    expect(inspectAttachments("facebook", "story", undefined, attachments, files).results[0].accepted).toBe(true);
    expect(inspectAttachments("youtube", "post", { format: "short" }, attachments, files).results[0].accepted).toBe(true);
    expect(inspectAttachments("linkedin", "post", { format: "short" }, attachments, files).issues).toContain("MEDIA_FORMAT_UNAVAILABLE");
  });
});
describe("weekly slots", () => {
  const slots = [{ day: 0, time: "02:30" }];
  it("skips a spring gap and reserves a fall overlap once using its earlier instant", () => {
    expect(nextPostingSlot(slots, "America/New_York", new Date("2027-03-13T00:00Z"), new Set())?.toISOString()).toBe("2027-03-21T06:30:00.000Z");
    const repeated = [{ day: 0, time: "01:30" }];
    const first = nextPostingSlot(repeated, "America/New_York", new Date("2027-11-07T00:00Z"), new Set())!;
    expect(first.toISOString()).toBe("2027-11-07T05:30:00.000Z");
    expect(nextPostingSlot(repeated, "America/New_York", new Date("2027-11-07T00:00Z"), new Set([first.getTime()]))?.toISOString()).toBe("2027-11-14T06:30:00.000Z");
  });
});
