import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoDmRuleInput } from "../../src/lib/social/auto-dm";
import { autoDmReady, commentRuleFor, emptyComposerAutoDm } from "../../src/lib/social/auto-dm-composer";
import { attestationStillHolds, blankRule, cooldownUnit, promotionalFlags, stepIssues, summarize, triggerOptions, withTrigger } from "../../src/lib/social/auto-dm-ui";
import { autoDmCapabilities } from "../../src/lib/social/auto-dm";

describe("auto-dm screens helpers", () => {
  it("lists every trigger with a reason when unavailable", () => {
    const ig = triggerOptions("instagram", autoDmCapabilities("instagram")), fb = triggerOptions("facebook", autoDmCapabilities("facebook"));
    expect(ig.filter(o => !o.available).map(o => [o.trigger, o.reason])).toEqual([["persistent_menu", "FACEBOOK_ONLY"], ["live_comment", "NO_LIVE_LOOKUP"]]);
    expect(fb.filter(o => !o.available).map(o => [o.trigger, o.reason])).toEqual([["story_reply", "INSTAGRAM_ONLY"], ["story_mention", "INSTAGRAM_ONLY"], ["ice_breaker", "INSTAGRAM_ONLY"], ["live_comment", "NO_LIVE_LOOKUP"]]);
    expect(triggerOptions("twitter", autoDmCapabilities("twitter")).every(o => !o.available)).toBe(true);
  });
  it("maps schema problems to steps and accepts a complete rule", () => {
    const rule = blankRule();
    expect(Object.entries(stepIssues(rule)).filter(([, v]) => v.length).map(([k]) => k)).toEqual(["trigger", "match", "response"]);
    const done = { ...rule, name: "Guide", match: { ...rule.match, keywords: ["guide"] }, response: { ...rule.response, text: "Hi {{firstName}}" }, serviceOnly: true };
    expect(Object.values(stepIssues(done)).flat()).toEqual([]);
    expect(autoDmRuleInput.safeParse(done).success).toBe(true);
  });
  it("drops fields of another trigger", () => {
    const rule = { ...blankRule(), postRef: "x", response: { ...blankRule().response, publicReply: "hi" } };
    expect(withTrigger(rule, "dm")).toMatchObject({ postRef: null, response: { publicReply: null } });
  });
  it("flags promotional wording and requires confirmation again after a text change", () => {
    expect(promotionalFlags("Our service times are 10am.")).toEqual([]);
    expect(promotionalFlags("Get 20% off, donate today")).toEqual(expect.arrayContaining(["% off", "donate"]));
    const saved = { ...blankRule(), serviceOnly: true, response: { ...blankRule().response, text: "a" } };
    expect(attestationStillHolds(saved, saved)).toBe(true);
    expect(attestationStillHolds(saved, { ...saved, response: { ...saved.response, text: "b" } })).toBe(false);
  });
  it("summarizes counts by outcome and reason", () => {
    const totals = summarize([{ state: "sent", reason: null, count: 3 }, { state: "skipped", reason: "cooldown", count: 2 }, { state: "handed_off", reason: null, count: 1 }, { state: "queued", reason: null, count: 1 }]);
    expect(totals).toMatchObject({ triggered: 7, sent: 3, skippedTotal: 2, handedOff: 1, inProgress: 1 });
    expect(totals.skipped.cooldown).toBe(2);
    expect(cooldownUnit(1440)).toEqual(["days", 1]); expect(cooldownUnit(90)).toEqual(["minutes", 90]);
  });
  it("builds a post-scoped comment rule from the composer row only when complete", () => {
    const row = { on: true, keyword: " guide ", reply: "Here it is", attested: true };
    expect(autoDmReady(emptyComposerAutoDm())).toBe(true); expect(autoDmReady({ ...row, attested: false })).toBe(false);
    const rule = commentRuleFor(row, "11111111-1111-4111-8111-111111111111");
    expect(autoDmRuleInput.safeParse(rule).success).toBe(true);
    expect(rule).toMatchObject({ trigger: "comment", purpose: "service", serviceOnly: true, match: { keywords: ["guide"] } });
  });
});

describe("auto-dm catalogue", () => {
  const messages = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;
  const lookup = (path: string) => path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), messages);
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
  it("has every statically used key of the Auto-DM components", () => {
    const missing: string[] = [];
    for (const file of files("src/components/social/auto-dm").filter(f => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, "utf8");
      const spaces = [...source.matchAll(/useTranslations\("([\w.]+)"\)/g)].map(m => m[1]);
      for (const use of source.matchAll(/\bt\("([\w.]+)"/g)) if (!spaces.some(ns => typeof lookup(`${ns}.${use[1]}`) === "string")) missing.push(`${file}: ${use[1]}`);
    }
    expect(missing).toEqual([]);
  });
});
