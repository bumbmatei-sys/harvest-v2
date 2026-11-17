import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { metricKeys, suppressCampaignMetrics, type CampaignConnectMetrics } from "../../src/server/connect-metrics";
const vector = (overrides: Partial<CampaignConnectMetrics> = {}) => ({ ...Object.fromEntries(metricKeys.map(k=>[k,0])), ...overrides }) as CampaignConnectMetrics;
it.each([0,1,2,3,4,5])("suppresses count %s", n => { expect(suppressCampaignMetrics(vector({ scans:n })).scans).toBe(n>0 && n<5 ? null : n); });
it("suppresses complementary cells and totals that disclose a small difference", () => { const out = suppressCampaignMetrics(vector({ associated:8, verifiedClaims:8, requested:5 })); expect(Object.values(out).every(n=>n===null)).toBe(true); expect(Object.values(suppressCampaignMetrics(vector({ pending:2, associated:10 }))).every(n=>n===null)).toBe(true); });
it("fails closed for malformed values and strips unlisted data", () => { expect(Object.values(suppressCampaignMetrics(vector({ scans:NaN }))).every(n=>n===null)).toBe(true); expect(suppressCampaignMetrics({ ...vector(), email: "synthetic@example.test" } as CampaignConnectMetrics)).not.toHaveProperty("email"); });

it("hides a small complement derived from sums of multiple cells",()=>{ expect(Object.values(suppressCampaignMetrics(vector({associated:11,verifiedClaims:11,requested:5,closed:5}))).every(n=>n===null)).toBe(true); });
