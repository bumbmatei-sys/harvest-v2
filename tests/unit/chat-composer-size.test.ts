import { describe, expect, it } from "vitest";
import { composerHeight, composerMaxHeight, composerMinHeight } from "../../src/lib/chat-composer-size";

describe("composerHeight", () => {
  it("is one 44px line for empty and short text", () => {
    expect(composerMinHeight).toBe(44);
    expect(composerHeight(0)).toBe(44);
    expect(composerHeight(40)).toBe(44);
    expect(composerHeight(44)).toBe(44);
  });
  it("grows by line up to four lines, then stops", () => {
    expect(composerHeight(64)).toBe(64);
    expect(composerMaxHeight).toBe(100);
    expect(composerHeight(100)).toBe(100);
    expect(composerHeight(400)).toBe(100);
  });
  it("falls back to one line for a non-finite measurement", () => {
    expect(composerHeight(Number.NaN)).toBe(44);
  });
});
