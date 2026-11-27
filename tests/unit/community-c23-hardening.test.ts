import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: vi.fn() }));
import { errorResponse } from "../../src/server/http";

// C23 release gate, static half. The database half is tests/integration/community-c23-hardening.test.ts.
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const communitySources = [
  ...readdirSync("src/server").filter((n) => /^communit(y|ies)[-.]/.test(n) && n.endsWith(".ts")).map((n) => `src/server/${n}`),
  ...walk("src/server/discover"), ...walk("src/app/api/communities"), ...walk("src/app/api/discover"),
  ...walk("src/app/communities"), ...walk("src/app/discover"),
  ...readdirSync("scripts").filter((n) => /communit/.test(n)).map((n) => `scripts/${n}`),
].filter((p) => /\.tsx?$/.test(p));

it("covers the community sources it audits", () => {
  expect(communitySources.length).toBeGreaterThan(40);
  expect(communitySources).toContain("src/server/community-forum.ts");
});

it("logs only fixed event names from community code: no ids, addresses, tokens or message text", () => {
  const offenders: string[] = [];
  for (const file of communitySources) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/console\.(log|info|warn|error|debug)\(([^)]*)\)/g)) {
      const arg = match[2].trim();
      // A summary of counts printed by a worker script is allowed; it carries no personal data by construction.
      const fixed = /^"[a-z0-9_]+"$/.test(arg) || (file.startsWith("scripts/") && /^JSON\.stringify\((result \?\? \{ alreadyRunning: true \}|\{ removed \})$/.test(arg));
      if (!fixed) offenders.push(`${file}: ${match[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("keeps audit metadata in community services to ids, field names and enums", () => {
  const offenders: string[] = [];
  for (const file of communitySources.filter((p) => p.startsWith("src/server/"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/insert\(auditLogs\)\.values\(([^;]*)\)/g)) {
      const metadata = match[1].match(/metadata:\s*(\{[^}]*\}|[a-zA-Z]+)/)?.[1] ?? "";
      if (/email|phone|address|body|note|message|answers|name\b|token/i.test(metadata)) offenders.push(`${file}: ${metadata}`);
    }
  }
  expect(offenders).toEqual([]);
});

// Every community and Discover API route starts with the hard-off 404 (before authentication), then the origin check on
// writes and the verified session. Either through a shared wrapper (each of which wraps communityRoute or discoverResponse),
// or inline in that order. Anonymous routes are listed with what protects them; a new anonymous route fails here.
const wrappers = /\b(communityRoute|communityChatRoute|dmRoute|communityLiveRoute|memberProfileRoute|discoverResponse)\b/;
const anonymous: Record<string, RegExp[]> = {
  "src/app/api/communities/[slug]/count/route.ts": [/status: 204/, /readBoundedJson\(request, 256/],
  "src/app/api/communities/unsubscribe/route.ts": [/Response\.json\(\{ ok: true \}/, /content-length/],
  "src/app/api/communities/email-feedback/route.ts": [/!COMMUNITY_EMAIL_FEEDBACK_ENABLED/, /return communityEmailFeedback\(request\)/],
  "src/app/api/discover/route.ts": [/private, no-store/],
};
it("routes every community API call through the hard-off, origin and session checks", () => {
  const routes = [...walk("src/app/api/communities"), ...walk("src/app/api/discover"), ...walk("src/app/api/account").filter((p) => p.includes("community-"))]
    .filter((p) => p.endsWith("route.ts"));
  expect(routes.length).toBeGreaterThan(60);
  const offenders: string[] = [];
  for (const route of routes) {
    const text = readFileSync(route, "utf8");
    if (/discoverResponse\(request, \{ write: true, session: false/.test(text)) offenders.push(`${route}: anonymous write`);
    if (wrappers.test(text)) continue;
    const off = text.search(/if \(!communitiesEnabled\(\)\) return/), session = text.search(/verifiedUser\(request\)/);
    if (off < 0) { offenders.push(`${route}: no hard-off 404`); continue; }
    if (anonymous[route]) { for (const check of anonymous[route]) if (!check.test(text)) offenders.push(`${route}: ${check}`); continue; }
    if (session < off) offenders.push(`${route}: no verified session after the hard-off check`);
    if (/export async function (POST|PUT|PATCH|DELETE)/.test(text) && !/verifyOrigin\(request\)/.test(text)) offenders.push(`${route}: write without origin check`);
  }
  expect(offenders).toEqual([]);
  for (const route of Object.keys(anonymous)) expect(routes).toContain(route);
  for (const file of ["src/server/community-chat.ts", "src/server/community-live.ts", "src/server/community-profile-details.ts"])
    expect(readFileSync(file, "utf8")).toMatch(/communityRoute\(run, ?\{? ?write|communityRoute\(run,options\)|communityRoute\(run, options\)/);
});

it("keeps Harvest Connect responses, consents and follow-up cases out of community services (PRD edge case 16)", () => {
  const pastoral = /\b(campaignResponses|campaignResponse[A-Z][A-Za-z]*|connect[A-Z][A-Za-z]*(Receipts|Events|Invitations|Subjects|Origins|Completions|States|Versions|Limits)|responseAccountClaims|followUpCases|campaignFollowupTeam|crmFormResponses|fundraisingPledges)\b/;
  const offenders = communitySources.filter((p) => p.startsWith("src/server/")).filter((p) => pastoral.test(readFileSync(p, "utf8")));
  expect(offenders).toEqual([]);
});

it("answers a database write limit with 429 and one fixed message", async () => {
  for (const error of [{ code: "P0429", message: "community_rate_limited internal" }, { cause: { code: "P0429" } }]) {
    const response = errorResponse(error);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(await response.json()).toEqual({ error: "You're posting a lot right now. Try again in a few minutes." });
  }
});
