import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Product copy rules, checked against every rendered string in messages/en.json.
const messages = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>;
function values(node: unknown, path: string[] = []): { key: string; text: string }[] {
  if (typeof node === "string") return [{ key: path.join("."), text: node }];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([key, child]) => values(child, [...path, key]));
  return [];
}
const all = values(messages);

describe("copy rules", () => {
  it("never names a vendor: no message mentions Zernio", () => {
    expect(all.filter(({ text }) => /zernio/i.test(text)).map(({ key }) => key)).toEqual([]);
  });

  it("calls companies organizations wherever a user can see it (placeholders aside)", () => {
    // `{company}` is an ICU argument name passed by code, not text a user reads.
    const visible = all.map(({ key, text }) => ({ key, text: text.replace(/\{company\}/g, "") }));
    expect(visible.filter(({ text }) => /\bcompan(y|ies)\b/i.test(text)).map(({ key }) => key)).toEqual([]);
  });
});
