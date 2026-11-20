import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256File, Sha256 } from "../../src/lib/social/sha256";
import { buildDocument, emptyComposer, emptyDestination, ringFor, ringTone, stateFromDocument, type Attachment, type ComposerState } from "../../src/lib/social/composer-state";
import { composerInput } from "../../src/lib/social/composer";
import { joinParts } from "../../src/lib/social/join";

const conn = [{ id: "11111111-1111-4111-8111-111111111111", platform: "twitter" as const }, { id: "22222222-2222-4222-8222-222222222222", platform: "instagram" as const }, { id: "33333333-3333-4333-8333-333333333333", platform: "tiktok" as const }];
const image = (key: string, over: Partial<Attachment> = {}): Attachment => ({ key, fileId: `00000000-0000-4000-8000-00000000000${key}`, name: `${key}.jpg`, mime: "image/jpeg", size: 10, kind: "image", previewUrl: null, altText: "", phase: "ready", progress: 100, error: null, ...over });

describe("sha256", () => {
  it("matches node for sizes around the block boundary and across slices", async () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 9 * 1024 * 1024 + 7]) {
      const data = randomBytes(size);
      expect(new Sha256().update(data).digestHex(), String(size)).toBe(createHash("sha256").update(data).digest("hex"));
      expect(await sha256File(new Blob([data])), String(size)).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
  it("is the same when fed in odd pieces", () => {
    const data = randomBytes(1000), hash = new Sha256();
    for (let i = 0; i < data.length; i += 37) hash.update(data.subarray(i, i + 37));
    expect(hash.digestHex()).toBe(createHash("sha256").update(data).digest("hex"));
  });
  it("stops when aborted", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(sha256File(new Blob([randomBytes(10)]), () => undefined, controller.signal)).rejects.toThrow();
  });
});

describe("rings and documents", () => {
  const base: ComposerState = { ...emptyComposer(), content: "x".repeat(140), connectionIds: conn.map(c => c.id) };
  it("uses the shared counter: 140 of 280 on X, an estimate flag where the server says estimate", () => {
    const x = ringFor(base, "twitter");
    expect(x).toMatchObject({ used: 140, limit: 280, rule: "estimate" });
    expect(ringFor(base, "bluesky")).toMatchObject({ used: 140, limit: 300, rule: "documented" });
  });
  it("turns near and over", () => {
    expect(ringTone({ used: 100, limit: 280, remaining: 180, rule: "estimate" })).toBe("ok");
    expect(ringTone({ used: 250, limit: 280, remaining: 30, rule: "estimate" })).toBe("near");
    expect(ringTone({ used: 281, limit: 280, remaining: -1, rule: "estimate" })).toBe("over");
    expect(ringTone({ used: 5, limit: null, remaining: null, rule: "unavailable" })).toBe("unknown");
  });
  it("a custom text changes only that account's ring", () => {
    const state = { ...base, destinations: { twitter: { ...emptyDestination(), custom: true, content: "short" } } };
    expect(ringFor(state, "twitter").used).toBe(5); expect(ringFor(state, "instagram").used).toBe(140);
  });
  it("builds a document the server schema accepts; sends ready files only, in order, with alt text", () => {
    const state: ComposerState = { ...base, attachments: [image("1", { altText: " a cross " }), image("2", { phase: "uploading", fileId: null }), image("3")] };
    const document = buildDocument(state, conn);
    expect(document.media.map(m => m.fileId)).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000003"]);
    expect(document.media[0].altText).toBe("a cross");
    expect(composerInput.safeParse(document).success).toBe(true);
  });
  it("per-account media and text overrides become custom variants; options only where set", () => {
    const state: ComposerState = { ...base, attachments: [image("1"), image("3")],
      destinations: { instagram: { ...emptyDestination(), mediaKeys: ["1"], options: { ...emptyDestination().options, firstComment: "More" } }, twitter: { ...emptyDestination(), custom: true, content: "own" } } };
    const { variants } = buildDocument(state, conn);
    expect(variants.instagram).toMatchObject({ mode: "custom", media: [{ fileId: "00000000-0000-4000-8000-000000000001" }], options: { firstComment: "More" } });
    expect(variants.twitter).toEqual({ mode: "custom", content: "own" });
    expect(variants.tiktok).toBeUndefined();
  });
  it("TikTok needs an explicit confirmation and it is never restored from a saved draft", () => {
    const options = { ...emptyDestination().options, tiktokPrivacy: "SELF_ONLY" as const };
    expect(buildDocument({ ...base, destinations: { tiktok: { ...emptyDestination(), options } } }, conn).variants.tiktok).toBeUndefined();
    const confirmed = buildDocument({ ...base, destinations: { tiktok: { ...emptyDestination(), options: { ...options, tiktokConfirmed: true } } } }, conn);
    expect(confirmed.variants.tiktok?.options?.tiktok).toEqual({ privacy: "SELF_ONLY", confirmedPreview: true, consent: true });
    const restored = stateFromDocument(confirmed);
    expect(restored.destinations.tiktok?.options).toMatchObject({ tiktokPrivacy: "SELF_ONLY", tiktokConfirmed: false });
  });
  it("joins only the parts that exist", () => { expect(joinParts(["a", "", null, "b"])).toBe("a · b"); });
});

describe("catalogue", () => {
  it("has every message key the Social screens use", () => {
    const catalogue = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;
    const get = (path: string) => path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), catalogue);
    const missing: string[] = [];
    for (const file of readdirSync("src/components/social").filter(name => name.endsWith(".tsx") || name.endsWith(".ts"))) {
      const source = readFileSync(`src/components/social/${file}`, "utf8");
      for (const [, name, namespace] of source.matchAll(/(\w+)\s*=\s*useTranslations\("(SocialPublish[^"]*)"\)/g)) {
        for (const [, key] of source.matchAll(new RegExp(`(?<![\\w.])${name}\\(\\s*"([\\w.]+)"`, "g"))) if (typeof get(`${namespace}.${key}`) !== "string") missing.push(`${namespace}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
