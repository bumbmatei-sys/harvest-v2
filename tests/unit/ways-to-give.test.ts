import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatIban, givingFieldIssues, givingKindRules, givingKinds, givingPlatforms, givingReportSchema, givingHandle, givingMethodInputSchema, givingUrl, publicGivingMethods, validBic, validIban } from "../../src/lib/ways-to-give";
import { bioDefinitionSchema, emptyBioDefinition, fieldIssues } from "../../src/lib/link-in-bio";
import { navEntries, resolveModeNavigation } from "../../src/lib/navigation";
import { can } from "../../src/lib/permissions";
import { permissionArea, roleToken } from "../../src/lib/access-areas";
import { waysToGiveEnabled } from "../../src/server/ways-to-give-mode";

const base = { label: "Give", enabled: true };
describe("IBAN and BIC", () => {
  it("accepts IBANs with correct check digits, in any spacing or case", () => {
    for (const iban of ["GB82WEST12345698765432", "DE89 3704 0044 0532 0130 00", "nl91abna0417164300", "FR1420041010050500013M02606", "RO49AAAA1B31007593840000"]) expect(validIban(iban), iban).toBe(true);
  });
  it("rejects wrong check digits, bad shapes and lengths", () => {
    for (const iban of ["GB82WEST12345698765431", "GB00WEST12345698765432", "DE8937040044", "1234567890123456", "GB82-WEST-1234-5698-7654-32", "", "GB82WEST1234569876543212345678901234567"]) expect(validIban(iban), iban).toBe(false);
  });
  it("formats in groups of four", () => expect(formatIban("gb82west12345698765432")).toBe("GB82 WEST 1234 5698 7654 32"));
  it("checks BIC shape", () => {
    expect(validBic("DEUTDEFF")).toBe(true); expect(validBic("deutdeff500")).toBe(true);
    for (const bic of ["DEUTDEF", "DEUT1EFF", "DEUTDEFF5", "DEUTDEFF5000"]) expect(validBic(bic)).toBe(false);
  });
});

describe("links", () => {
  it("takes only https on the exact hosts of a named kind", () => {
    expect(givingUrl("paypal", "https://paypal.me/GraceChurch")).toBe("https://paypal.me/GraceChurch");
    expect(givingUrl("paypal", "https://www.paypal.com/donate?hosted_button_id=X")).toBe("https://www.paypal.com/donate?hosted_button_id=X");
    expect(givingUrl("wise", "https://wise.com/pay/me/grace")).toBe("https://wise.com/pay/me/grace");
    expect(givingUrl("revolut", "https://revolut.me/grace")).toBe("https://revolut.me/grace");
    for (const bad of ["http://paypal.me/x", "https://paypal.me.evil.example/x", "https://evilpaypal.me/x", "https://user:pw@paypal.me/x", "https://paypal.me:8443/x", "javascript:alert(1)", "https://pay pal.me"])
      expect(givingUrl("paypal", bad), bad).toBeNull();
    expect(givingUrl("wise", "https://paypal.me/x")).toBeNull();
  });
  it("has no free 'any link' kind: every platform is held to its own hosts", () => {
    expect((givingKinds as readonly string[]).includes("other")).toBe(false);
    expect(givingUrl("gofundme", "https://www.gofundme.com/f/grace")).toBe("https://www.gofundme.com/f/grace");
    expect(givingUrl("gofundme", "https://gofund.me/abc123")).toBe("https://gofund.me/abc123");
    expect(givingUrl("donorbox", "https://donorbox.org/grace")).toBe("https://donorbox.org/grace");
    expect(givingUrl("tithely", "https://give.tithe.ly/?formId=1")).toBe("https://give.tithe.ly/?formId=1");
    expect(givingUrl("ko_fi", "https://ko-fi.com/grace")).toBe("https://ko-fi.com/grace");
    for (const [kind, bad] of [["gofundme", "https://give.example.org/now"], ["donorbox", "https://gofundme.com/f/x"], ["patreon", "https://patreon.com.evil.example/x"], ["zeffy", "https://203.0.113.9/give"],
      ["every_org", "https://every.org:444/"], ["justgiving", "data:text/html,x"]] as const) expect(givingUrl(kind, bad), bad).toBeNull();
    for (const platform of givingPlatforms) expect(givingKindRules[platform].url).toBe("required");
  });
  it("keeps the database host allow-list in step with this one", () => {
    const sqlText = readFileSync("drizzle/0119_ways_to_give.sql", "utf8");
    const inDb = Object.fromEntries([...sqlText.matchAll(/WHEN '([a-z_]+)' THEN host IN \(([^)]*)\)/g)].map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((h) => h[1])]));
    const inCode = Object.fromEntries(givingKinds.filter((kind) => (givingKindRules[kind].hosts ?? []).length).map((kind) => [kind, [...givingKindRules[kind].hosts!]]));
    expect(inDb).toEqual(inCode);
  });
  it("takes one ministry subdomain for Planning Center Giving", () => {
    expect(givingUrl("planning_center", "https://gracechurch.churchcenter.com/giving")).toBe("https://gracechurch.churchcenter.com/giving");
    for (const bad of ["https://churchcenter.com/giving", "https://a.b.churchcenter.com/giving", "https://www.churchcenter.com/", "https://evilchurchcenter.com/", "https://grace.churchcenter.com.evil.example/"])
      expect(givingUrl("planning_center", bad), bad).toBeNull();
  });
});

describe("handles", () => {
  it("normalises per kind", () => {
    expect(givingHandle("venmo", "grace-church")).toBe("@grace-church");
    expect(givingHandle("revolut", "@GraceChurch")).toBe("@gracechurch");
    expect(givingHandle("cash_app", "GraceChurch")).toBe("$GraceChurch");
    expect(givingHandle("zelle", "Give@Example.org")).toBe("give@example.org");
    expect(givingHandle("zelle", "+1 (555) 010-0199")).toBe("+1 (555) 010-0199");
    for (const [kind, bad] of [["venmo", "@ab"], ["cash_app", "$1abc"], ["zelle", "not a contact"], ["paypal", "@grace"]] as const) expect(givingHandle(kind, bad), bad).toBeNull();
  });
});

describe("method input", () => {
  it("normalises a bank transfer and keeps only its own fields", () => {
    const parsed = givingMethodInputSchema.parse({ ...base, kind: "bank_transfer", iban: "gb82 west 1234 5698 7654 32", bic: "westgb2l", accountHolder: " Grace Church ", note: "Gift" });
    expect(parsed).toEqual({ kind: "bank_transfer", label: "Give", url: null, handle: null, iban: "GB82WEST12345698765432", bic: "WESTGB2L", accountHolder: "Grace Church", note: "Gift", enabled: true });
  });
  it("names the field that is wrong", () => {
    expect(givingFieldIssues({ ...base, kind: "bank_transfer", iban: "GB82WEST12345698765431", accountHolder: "" })).toMatchObject({ iban: "iban", accountHolder: "required" });
    expect(givingFieldIssues({ ...base, kind: "paypal", url: "https://example.org" })).toEqual({ url: "url" });
    expect(givingFieldIssues({ ...base, kind: "venmo" })).toEqual({ handle: "required" });
    expect(givingFieldIssues({ ...base, kind: "venmo", url: "https://venmo.com/u/grace", handle: "@gracechurch" })).toEqual({ handle: "one_of" });
    expect(givingFieldIssues({ ...base, kind: "zelle", handle: "give@example.org", url: "https://example.org" })).toEqual({ url: "not_allowed" });
    expect(givingFieldIssues({ ...base, kind: "givebutter", url: "https://givebutter.com/grace", iban: "GB82WEST12345698765432" })).toEqual({ iban: "not_allowed" });
    expect(givingFieldIssues({ ...base, label: "  ", kind: "givebutter", url: "https://givebutter.com/grace" })).toMatchObject({ label: "required" });
    expect(givingFieldIssues({ ...base, label: "<b>", kind: "givebutter", url: "https://givebutter.com/grace" })).toMatchObject({ label: "invalid" });
    expect(givingFieldIssues({ ...base, kind: "cash_app", handle: "$Grace" })).toEqual({});
  });
  it("re-checks what the database returns before a visitor sees it", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const ok = { id, kind: "paypal", label: "PayPal", url: "https://paypal.me/x", handle: null, iban: null, bic: null, accountHolder: null, note: null };
    expect(publicGivingMethods([ok, { ...ok, url: "https://evil.example/x" }, { ...ok, kind: "bank_transfer", url: null, iban: "GB00WEST12345698765432" }, { junk: true }])).toEqual([ok]);
    expect(publicGivingMethods(null)).toEqual([]);
  });
});

describe("reports", () => {
  it("takes a known reason and an optional short note, and nothing else", () => {
    expect(givingReportSchema.parse({ reason: "impersonation", note: "  not them " })).toEqual({ reason: "impersonation", note: "not them" });
    expect(givingReportSchema.parse({ reason: "scam", note: "   " })).toEqual({ reason: "scam", note: null });
    for (const bad of [{ reason: "spam" }, { reason: "scam", note: "x".repeat(501) }, { reason: "scam", email: "a@b.c" }, {}]) expect(givingReportSchema.safeParse(bad).success).toBe(false);
  });
});

describe("link-in-bio block, navigation and access", () => {
  it("allows one Ways to give block with a heading", () => {
    const block = { type: "giving" as const, id: "givegive", hidden: false, tab: "partnership" as const, title: "Ways to give" };
    expect(bioDefinitionSchema.safeParse({ ...emptyBioDefinition("x"), blocks: [block] }).success).toBe(true);
    expect(bioDefinitionSchema.safeParse({ ...emptyBioDefinition("x"), blocks: [block, { ...block, id: "givegiv2" }] }).success).toBe(false);
    expect(fieldIssues({ ...emptyBioDefinition("x"), blocks: [{ ...block, title: "" }] })).toEqual({ givegive: "required" });
  });
  it("lists Ways to give under Operations > Giving for owners and admins only, when the feature is on", () => {
    const entry = navEntries.find((e) => e.id === "waysToGive")!;
    expect(entry).toMatchObject({ group: "giving", mode: "operations", permission: "giving:manage", feature: "giving", path: "/giving/ways-to-give" });
    expect(entry.status).toBeUndefined();
    const giving = (role: string, features: ("giving")[] = ["giving"]) => resolveModeNavigation({ tenantId: "t", role, pathname: "/workspaces/t/giving/ways-to-give", features, mode: "operations" }).groups.find((g) => g.id === "giving");
    expect(giving("owner")?.items.map((i) => [i.id, i.active])).toEqual([["waysToGive", true]]);
    expect(giving("admin")?.items.length).toBe(1);
    expect(giving("member")).toBeUndefined(); expect(giving("viewer")).toBeUndefined(); expect(giving("owner", [])).toBeUndefined();
    expect(giving(roleToken("collaborator", { giving: "manage" }))?.items.length).toBe(1);
    expect(giving(roleToken("collaborator", { giving: "view" }))).toBeUndefined();
    expect(giving(roleToken("collaborator", { website: "manage" }))).toBeUndefined();
  });
  it("maps the capability to the Giving area", () => {
    expect(permissionArea["giving:manage"]).toBe("giving");
    expect([can("owner", "giving:manage"), can("admin", "giving:manage"), can("member", "giving:manage"), can("viewer", "giving:manage"), can("guest", "giving:manage")]).toEqual([true, true, false, false, false]);
  });
  it("is off in production", () => {
    expect(waysToGiveEnabled({ NODE_ENV: "development" })).toBe(true);
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { HARVEST_ENV: "production" }]) expect(waysToGiveEnabled(env)).toBe(false);
  });
});
