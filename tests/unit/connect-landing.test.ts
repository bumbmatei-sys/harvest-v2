import { describe, expect, it } from "vitest";
import { landingDefinition, safeLandingUrl, saveLandingInput, sameLandingDefinition } from "../../src/lib/connect-landing";
import { landingBody } from "../../src/server/connect-landing-http";
const card = { kind: "external", category: "course", title: "Optional course", description: "", url: "https://learn.example.org/course?lang=en#start", price: "paid" };
describe("landing definitions", () => {
  it("accepts ordered free resources and labeled external offers with escaped/plain text", () => {
    const d = { heading: '<script>alert("test")</script>', message: "Welcome\nExplore freely", cards: [{ kind: "resource", resourceId: "common-questions" }, card] };
    expect(landingDefinition.parse(d)).toEqual(d);
    expect(landingDefinition.safeParse({ ...d, cards: [{ ...card, category: "community" }] }).success).toBe(false);
  });
  it.each(["http://example.org", "https://user:pass@example.org", "https://localhost", "https://sub.localhost", "https://localhost.", "https://127.0.0.1", "https://127.1", "https://2130706433", "https://0x7f000001", "https://[::1]", "https://%65xample.org", "https://example.org\\@evil.org", "https://example.org\n", "javascript:alert(1)", "https://example.org:0", "https://example.org:65536", "https://example.org/\u007f"])('rejects unsafe URL %s', url => expect(safeLandingUrl(url)).toBe(false));
  it.each(["https://example.org", "HTTPS://EXAMPLE.ORG/path", "https://sub.example.org:8443/a?x=1&y=2#ok", "https://example.org/a%20b"])('accepts public HTTPS URL %s', url => expect(safeLandingUrl(url)).toBe(true));
  it("compares JSONB content without key-order false positives", () => {
    const d = { heading: "Welcome", message: "", cards: [card] };
    expect(sameLandingDefinition(landingDefinition.parse(d), landingDefinition.parse(JSON.parse(JSON.stringify(d))))).toBe(true);
    expect(sameLandingDefinition(landingDefinition.parse(d), landingDefinition.parse({ ...d, heading: "Changed" }))).toBe(false);
  });
  it("bounds every text and card field and rejects additional consent/account/embedding properties", () => {
    for (const d of [{ heading: "a".repeat(121), message: "", cards: [] }, { heading: "", message: "a".repeat(601), cards: [] },
      { heading: "", message: "", cards: Array(9).fill(card) }, { heading: "", message: "", cards: [{ ...card, title: " " }] },
      { heading: "", message: "", cards: [{ ...card, description: "a".repeat(301) }] },
      { heading: "", message: "", cards: [{ ...card, embed: true }] }, { heading: "", message: "", cards: [], invitation: true },
      { heading: "\u0001", message: "", cards: [] }, { heading: "\ud800", message: "", cards: [] }]) expect(landingDefinition.safeParse(d).success).toBe(false);
    expect(saveLandingInput.safeParse({ definition: { heading: "", message: "", cards: [] }, expectedRevision: 0 }).success).toBe(false);
  });
  it("bounds chunked request bodies without relying on content length", async () => {
    const req = (body: string) => new Request("https://example.org", { method: "PUT", body });
    expect(await landingBody(req('{"expectedRevision":0}'))).toEqual({ expectedRevision: 0 });
    await expect(landingBody(req(" ".repeat(32769)))).rejects.toMatchObject({ status: 400 });
    await expect(landingBody(req("{"))).rejects.toBeInstanceOf(SyntaxError);
  });
});
