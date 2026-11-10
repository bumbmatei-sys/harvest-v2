import { expect, it } from "vitest";
import { MAX_SOURCE_RULES, fullState, paramsToState, parseSourceRule, serializeSourceRule, sourceRule, stateToParams, viewState } from "../../src/lib/crm-fields";

const campaign = "11111111-1111-4111-8111-111111111111", link = "22222222-2222-4222-8222-222222222222";
it("round-trips a source rule through the URL in canonical form", () => {
  const rule = sourceRule.parse({ mode: "exclude", match: "first", kinds: ["connect"], campaigns: [campaign], links: [link], route: "qr", from: "2026-01-01", to: "2026-02-01" });
  const raw = serializeSourceRule(rule);
  expect(raw).toBe(`exclude~first~connect~${campaign}~${link}~~qr~2026-01-01~2026-02-01`);
  expect(parseSourceRule(raw)).toEqual(rule);
  const params = stateToParams(fullState({ sources: [rule] }));
  expect(params.getAll("s")).toEqual([raw]);
  expect(paramsToState("person", { s: raw })?.state.sources).toEqual([rule]);
});
it("rejects malformed, contradictory or oversized rules", () => {
  for (const raw of ["", "include", "include~any~connect~~~~~~~extra", "include~any~unknown,manual~~~~~~", `include~any~unknown~${campaign}~~~~~`,
    `include~any~manual~${campaign}~~~~~`, "include~latest~unknown~~~~~~", "include~any~connect~not-a-uuid~~~~~", "include~any~connect,connect~~~~~~",
    "include~any~connect~~~~~2026-02-01~2026-01-01", "include~any~connect~~~~sms~~", "maybe~any~connect~~~~~~", "include~any~connect~~~~~2026-13-01~", "x".repeat(3001)]) {
    expect(parseSourceRule(raw), raw).toBeNull();
  }
  const ok = "include~any~connect~~~~~~";
  expect(paramsToState("person", { s: Array(MAX_SOURCE_RULES + 1).fill(ok) })).toBeNull();
  expect(paramsToState("company", { s: ok })).toBeNull();
  expect(paramsToState("person", { s: [ok, "broken"] })).toBeNull();
});
it("keeps old saved views valid with no source rules", () => {
  expect(viewState.parse({ q: "", sort: "name", filters: [], columns: null, density: "comfortable" }).sources).toEqual([]);
  expect(stateToParams(fullState({})).has("s")).toBe(false);
});
it("splits follow-up permission into email and SMS filters", () => {
  expect(paramsToState("person", { f: "followup_email~any_of~granted" })).not.toBeNull();
  expect(paramsToState("person", { f: "followup_sms~any_of~withdrawn" })).not.toBeNull();
  expect(paramsToState("person", { f: "newsletter~is_empty~" })).not.toBeNull();
});
