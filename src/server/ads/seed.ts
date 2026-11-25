import type { FakeAdsProvider } from "./fake-provider";
import type { RemoteAd, RemoteAdSet, RemoteCampaign, ResultRow } from "./contract";
import type { AdFormat, AdGoal, AdStatus } from "../../lib/ads/ads";

// Invented ads data for the screens and browser tests. It exists only inside the in-memory fake, which only the open non-production gate can reach; every name, number and
// address is made up (example domains only), and nothing here is ever sent anywhere.
export const SYNTHETIC_ADS_ACCOUNT_REF = "test-facebook";
export const SYNTHETIC_META_ACCOUNT = "act_demo_meta";
export const SYNTHETIC_GOOGLE_ACCOUNT = "act_demo_google";

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
/** Small deterministic generator so every run of a test sees the same numbers. */
function rng(seed: number) { let s = seed; return () => { s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296; return s / 4_294_967_296; }; }

type AdSpec = [name: string, format: AdFormat, status?: AdStatus, review?: RemoteAd["review"], issue?: string | null];
const adOf = (ref: string, spec: AdSpec): RemoteAd => ({ ref, name: spec[0], status: spec[2] ?? "active", format: spec[1], creativeRef: null, sourcePostRef: null, leadFormRef: null,
  review: spec[3] ?? "approved", reviewReason: spec[3] === "rejected" ? "The text does not meet the network's advertising policy." : null, deliveryIssue: spec[4] ?? null });
const setOf = (ref: string, name: string, status: AdStatus, budget: number, ads: RemoteAd[], extra: Partial<RemoteAdSet> = {}): RemoteAdSet =>
  ({ ref, name, status, budgetAmount: budget, budgetType: "daily", startDate: day(60), endDate: null, bidding: { costType: "lowest_cost" }, targeting: { countries: ["US"], ageMin: 25, ageMax: 55 }, ads, ...extra });

export function seedSyntheticAds(fake: FakeAdsProvider) {
  fake.addAccount(SYNTHETIC_ADS_ACCOUNT_REF, { ref: SYNTHETIC_META_ACCOUNT, name: "Grace Church ads", network: "meta", currency: "USD", timezone: "America/Chicago" });
  fake.addAccount(SYNTHETIC_ADS_ACCOUNT_REF, { ref: SYNTHETIC_GOOGLE_ACCOUNT, name: "Grace Church search", network: "google", currency: "USD", timezone: "America/Chicago" });
  const meta = fake.remotes.get(`${SYNTHETIC_ADS_ACCOUNT_REF}\u0000${SYNTHETIC_META_ACCOUNT}`)!;
  const google = fake.remotes.get(`${SYNTHETIC_ADS_ACCOUNT_REF}\u0000${SYNTHETIC_GOOGLE_ACCOUNT}`)!;
  const camp = (ref: string, name: string, goal: AdGoal, status: AdStatus, budget: number | null, sets: RemoteAdSet[], extra: Partial<RemoteCampaign> = {}): RemoteCampaign =>
    ({ ref, name, goal, status, budgetAmount: budget, budgetType: "daily", budgetLevel: budget === null ? "adset" : "campaign", sharedBudgetRef: null, startDate: day(60), endDate: null, bidding: null, specialAdCategories: [], attributionModel: "default", adSets: sets, ...extra });
  meta.campaigns.push(
    camp("c1", "Easter service invitation", "traffic", "active", 25, [
      setOf("s1", "Local families", "active", 0, [adOf("a1", ["Easter video", "video"]), adOf("a2", ["Easter photo", "image"]), adOf("a3", ["Easter text", "text", "paused", "approved"])], { budgetAmount: null }),
      setOf("s2", "Young adults", "active", 0, [adOf("a4", ["Join us Sunday", "image", "active", "in_review"])], { budgetAmount: null, targeting: { countries: ["US"], ageMin: 18, ageMax: 30 } }),
    ]),
    camp("c2", "Youth camp sign-up", "lead_generation", "active", null, [
      setOf("s3", "Parents 35 to 55", "active", 15, [adOf("a5", ["Camp lead form", "image", "active", "approved"]), adOf("a6", ["Camp carousel", "carousel", "active", "rejected"])]),
      setOf("s4", "Teens 14 to 17", "paused", 10, [adOf("a7", ["Camp video", "video", "paused"])]),
    ]),
    camp("c3", "Food drive awareness", "awareness", "paused", 12, [setOf("s5", "Whole city", "paused", 0, [adOf("a8", ["Food drive photo", "image", "paused"])], { budgetAmount: null })]),
    camp("c4", "Christmas Eve boost", "engagement", "active", 30, [setOf("s6", "Existing followers", "active", 0, [adOf("a9", ["Boosted post", "image", "active", "approved", "budget_capped"])], { budgetAmount: null, endDate: day(-20) })], { endDate: day(-20) }),
  );
  google.campaigns.push(camp("g1", "Church near me search", "traffic", "active", 20, [setOf("gs1", "Search ad group", "active", 0, [adOf("ga1", ["Search ad", "text"])], { budgetAmount: null })]));
  const rows = (remote: typeof meta, levelOf: (ref: string) => ResultRow["level"], refs: string[], seed: number) => {
    const next = rng(seed);
    for (const ref of refs) for (let d = 0; d < 90; d++) {
      if (ref === "c3" || ref === "s5" || ref === "a8") { if (d < 45) continue; }
      const impressions = Math.round(800 + next() * 2200), clicks = Math.round(impressions * (0.01 + next() * 0.03)), spend = Math.round((4 + next() * 14) * 100) / 100;
      const metrics: ResultRow["metrics"] = { spend, impressions, clicks, reach: Math.round(impressions * (0.55 + next() * 0.2)), results: Math.round(clicks * (0.1 + next() * 0.2)) };
      if (ref === "c4" || ref === "s6" || ref === "a9") delete metrics.results;
      remote.results.push({ level: levelOf(ref), ref, day: day(d), metrics });
    }
  };
  const level = (ref: string): ResultRow["level"] => ref.startsWith("c") || ref.startsWith("g") && !ref.startsWith("gs") && !ref.startsWith("ga") ? "campaign" : /^(s|gs)/.test(ref) ? "adset" : "ad";
  rows(meta, level, ["c1", "c2", "c3", "c4", "s1", "s2", "s3", "s4", "s5", "s6", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"], 7);
  rows(google, level, ["g1", "gs1", "ga1"], 11);
  meta.forms.push({ ref: "f1", name: "Youth camp sign-up", status: "active", questions: ["full_name", "email", "phone", "consent_follow_up"], consentText: "We use your answers to reply about Grace Church. Your details are not shared with anyone else." });
  meta.leads.push(
    { ref: "l1", network: "meta", formRef: "f1", campaignRef: "c2", adRef: "a5", fields: { full_name: "Ada Example", email: "ada@example.test", phone: "+15550100101", consent_follow_up: "yes" }, submittedAt: new Date(Date.now() - 86_400_000) },
    { ref: "l2", network: "meta", formRef: "f1", campaignRef: "c2", adRef: "a5", fields: { full_name: "Ben Example", email: "ben@example.test", consent_follow_up: "no" }, submittedAt: new Date(Date.now() - 2 * 86_400_000) },
  );
  meta.audiences.push({ ref: "au1", kind: "custom", name: "Website visitors", sizeEstimate: 1800, spec: null }, { ref: "au2", kind: "lookalike", name: "Lookalike of attenders", sizeEstimate: 90_000, spec: null });
  meta.posts.push({ ref: "p1", platform: "facebook", caption: "Join us this Sunday for a special service", publishedAt: new Date(Date.now() - 3 * 86_400_000) }, { ref: "p2", platform: "instagram", caption: "Behind the scenes at youth night", publishedAt: new Date(Date.now() - 6 * 86_400_000) });
  meta.identities.push({ ref: "i1", name: "Grace Church", sparkCodeSupported: false });
  meta.health.checks = { account_status: { state: "ok" }, payment_method: { state: "ok" }, spend_limit: { state: "ok" }, page_link: { state: "ok" }, instagram_link: { state: "warning", fixUrl: "https://example.test/fix" }, lead_ads_terms: { state: "ok" }, pixel: { state: "unknown" }, whatsapp_link: { state: "unknown" } };
}
