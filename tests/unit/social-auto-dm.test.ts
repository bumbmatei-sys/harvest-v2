import { describe, expect, it } from "vitest";
import { autoDmCapabilities, autoDmOpen, autoDmRuleInput, matchAutoDm, renderAutoDm } from "../../src/lib/social/auto-dm";

describe("automation rules", () => {
  it("keeps story triggers Instagram-only and presents supported entry points separately", () => {
    expect(autoDmCapabilities("instagram")).toMatchObject({ comment:"conditional",story_reply:"conditional",story_mention:"conditional",ice_breaker:"conditional",persistent_menu:"unavailable" });
    expect(autoDmCapabilities("facebook")).toMatchObject({ dm:"conditional",story_reply:"unavailable",story_mention:"unavailable",persistent_menu:"conditional",ice_breaker:"unavailable" });
    expect(Object.values(autoDmCapabilities("youtube")).every(value=>value==="unavailable")).toBe(true);
  });
  it("supports exact, contains, word and any-keyword matching with explicit exclusion", () => {
    const word = { mode:"word" as const, caseSensitive:false, keywords:["a+b"], exclude:["ignore"], stop:["stop"] };
    expect(matchAutoDm(word,"Near A+B!")).toBe("matched");
    expect(matchAutoDm(word,"xa+b!")).toBe("excluded");
    expect(matchAutoDm(word,"STOP A+B")).toBe("stop");
    expect(matchAutoDm(word,"ignore A+B")).toBe("excluded");
    expect(matchAutoDm(word,null)).toBe("unavailable");
    expect(matchAutoDm({...word,mode:"exact"},"A+B!")).toBe("excluded");
    expect(matchAutoDm({...word,mode:"contains"},"xa+b!")).toBe("matched");
    expect(matchAutoDm({...word,mode:"any",keywords:["none","yes"]},"Yes")).toBe("matched");
    expect(matchAutoDm({...word,caseSensitive:true},"A+B")).toBe("excluded");
  });
  it("checks local hours across DST and handles missing names without persisting content", () => {
    const hours=[{ day:7,start:"03:00",end:"04:00" }];
    expect(autoDmOpen(new Date("2026-03-29T01:20:00Z"),{timezone:"Europe/Berlin",hours})).toBe(true);
    expect(autoDmOpen(new Date("2026-03-29T00:20:00Z"),{timezone:"Europe/Berlin",hours})).toBe(false);
    expect(renderAutoDm("Hello {{ firstName }}!")).toBe("Hello there!");
  });
  it("rejects follow-ups for service templates and private comment media", () => {
    const rule={name:"Greeting",trigger:"dm",match:{mode:"contains",keywords:["hello"]},serviceOnly:true,
      response:{text:"Hi",followup:{text:"See you",delayMinutes:10}}};
    expect(autoDmRuleInput.safeParse(rule).success).toBe(false);
    expect(autoDmRuleInput.safeParse({...rule,purpose:"marketing"}).success).toBe(true);
    expect(autoDmRuleInput.safeParse({...rule,trigger:"comment",purpose:"marketing"}).success).toBe(false);
  });
});
