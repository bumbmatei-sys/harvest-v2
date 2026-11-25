import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { linkConnection } from "../../src/server/social/service";
import { AccessError } from "../../src/server/permissions";
import { FakeAdsProvider } from "../../src/server/ads/fake-provider";
import type { AdsDeps } from "../../src/server/ads/registry";
import { linkAdAccounts, syncAdAccount } from "../../src/server/ads/accounts";
import { adsResponse } from "../../src/server/ads/http";
import { testDatabase } from "../database";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

let f: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("@/db/client", () => ({ getDb: () => f.db }));
vi.mock("@/server/http", async (original) => ({
  ...await original<typeof import("../../src/server/http")>(),
  verifyOrigin: () => {},
  verifiedUser: async (request: Request) => { const user = request.headers.get("x-test-user"); if (!user) throw new AccessError(401, "Sign in to continue."); return user; },
}));

const ads = new FakeAdsProvider(CANARY);
const deps: AdsDeps = { enabled: true, provider: () => ads, now: () => new Date(), features: { leadFormPublish: true } };
let p: Awaited<ReturnType<typeof seedPeople>>, acct: string, network: ReturnType<typeof noNetwork>;

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  p = await seedPeople(f, "ar");
  useTestKeys(); network = noNetwork();
  const conn = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, depsFor(newFake()))).connection.id;
  ads.addAccount("acc-fb-2", { ref: "act_1", name: "Grace ads" });
  acct = (await linkAdAccounts(f.db, p.owner, p.tenant, { connectionId: conn }, deps)).accounts[0].id;
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
}, 60_000);
afterAll(async () => { expect(network).not.toHaveBeenCalled(); network?.mockRestore(); useKeyProvider(null); await f?.close(); });

const call = (method: string, path: string[], body?: unknown, user = p.owner) => adsResponse(new Request("http://localhost/x", { method, headers: { "x-test-user": user, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  { params: Promise.resolve({ tenantId: p.tenant, path }) }, deps);

it("accepts an idempotency key on the lead form routes (it is not part of the strict input)", async () => {
  const created = await call("POST", ["lead-forms"], { adAccountId: acct, name: "Visit", consentText: "Thanks for your interest.", privacyUrl: "https://example.test/privacy", questions: ["full_name", "email"], idempotencyKey: randomUUID() });
  expect(created.status).toBe(201);
  const draft = await call("POST", ["lead-form-drafts"], { network: "meta", privacyUrl: "https://example.test/privacy" });
  expect(draft.status).toBe(201);
  const { id } = await draft.json() as { id: string };
  const published = await call("POST", ["lead-form-drafts", id, "publish"], { adAccountId: acct, revision: 1, idempotencyKey: randomUUID() });
  expect(published.status).toBe(200);
  expect(await published.json()).toMatchObject({ outcome: "published" });
  // Without a key the request is refused as invalid input, not as an unknown field.
  const missing = await call("POST", ["lead-forms"], { adAccountId: acct, name: "Again", consentText: "x", privacyUrl: "https://example.test/p", questions: ["email"] });
  expect(missing.status).toBe(422);
});
