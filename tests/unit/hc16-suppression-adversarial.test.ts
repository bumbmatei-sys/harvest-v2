import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { metricKeys, suppressCampaignMetrics, type CampaignConnectMetrics } from "../../src/server/connect-metrics";
import { followUpCaseStates } from "../../src/lib/follow-up-cases";

const vector = (overrides: Partial<CampaignConnectMetrics>) => ({
  ...Object.fromEntries(metricKeys.map(key => [key, 0])), ...overrides,
}) as CampaignConnectMetrics;

it.each([1, 2, 3, 4])("hides residual cohort %s across multiple case-state cells", residual => {
  const states = Object.fromEntries(followUpCaseStates.map((state, i) => [state, i % 2 ? 10 : 5]));
  const caseTotal = Object.values(states).reduce((a, b) => a + b, 0);
  const result = suppressCampaignMetrics(vector({ ...states, associated: caseTotal + residual, verifiedClaims: caseTotal + residual }));
  expect(Object.values(result).every(value => value === null)).toBe(true);
});

it("released generated vectors disclose neither a small cell nor a related partition complement", () => {
  // Independent cohort oracle: cases partition associated responses; compare each union of states
  // against the associated cohort. This does not recreate the implementation's generic subset-sum search.
  let released = 0, hidden = 0;
  for (let seed = 0; seed < 160; seed++) {
    const states = Object.fromEntries(followUpCaseStates.map((state, i) => [state, ((seed * (i + 3) + i * i) % 5) * 5]));
    const sum = Object.values(states).reduce((a, b) => a + b, 0);
    const associated = sum + seed % 5;
    const input = vector({ ...states, scans: 300, pending: (seed % 4) * 5, associated, verifiedClaims: associated });
    const output = suppressCampaignMetrics(input);
    if (Object.values(output).every(value => value === null)) { hidden++; continue; }
    released++;
    expect(output).toEqual(input);
    for (const value of Object.values(output)) expect(value === 0 || value! >= 5).toBe(true);
    for (let mask = 0; mask < 1 << followUpCaseStates.length; mask++) {
      const union = followUpCaseStates.reduce((n, state, i) => n + (mask & 1 << i ? output[state]! : 0), 0);
      const complement = output.associated! - union;
      expect(complement === 0 || complement >= 5).toBe(true);
    }
  }
  expect(released).toBeGreaterThan(0); expect(hidden).toBeGreaterThan(0);
});

it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER])("fails closed for unsafe aggregate %s", count => {
  expect(Object.values(suppressCampaignMetrics(vector({ scans: count }))).every(value => value === null)).toBe(true);
});
