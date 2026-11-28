import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/http", async original => {
  const { AccessError } = await import("../../src/server/permissions");
  return { ...await original<typeof import("../../src/server/http")>(), verifiedUser: async () => { throw new AccessError(401, "Sign in"); } };
});
vi.mock("../../src/db/client", async original => ({
  ...await original<typeof import("../../src/db/client")>(),
  getDb: vi.fn(() => { throw new Error("Finance DB must stay unopened"); }),
}));
import { ministryApplicationFee, paymentPolicy } from "../../src/lib/ministry-payments";
import { CONNECT_LIVE_ENABLED, CONNECT_WEBHOOK_SECRET, stripeConnectAdapter } from "../../src/server/ministry-payments/provider";
import { validConnectSignature } from "../../src/server/ministry-payments/webhook";
import { POST } from "../../src/app/api/payments/stripe/connect-webhook/route";
import { GET as readLedger } from "../../src/app/api/workspaces/[tenantId]/payments/ledger/route";

afterEach(() => vi.unstubAllEnvs());

it("returns a neutral 404 for an anonymous finance read without opening a DB connection", async () => {
  vi.stubEnv("HARVEST_SYNTHETIC_MINISTRY_PAYMENTS", "1");
  const response = await readLedger(new Request("https://app.example.invalid"), {
    params: Promise.resolve({ tenantId: "0c341737-eea5-421c-af34-0b325c7eab2b" }),
  });
  expect(response.status).toBe(404);
});


it("uses the central integer fee table and rounds down", () => {
  expect(ministryApplicationFee("donation", 10_001n)).toBe(0n);
  expect(ministryApplicationFee("sale", 33n)).toBe(0n);
  expect(ministryApplicationFee("sale", 34n)).toBe(1n);
  expect(ministryApplicationFee("sale", 10_001n)).toBe(300n);
  expect(paymentPolicy).toEqual({ donorCoversFee: false, giftAid: false, paymentCountries: [], feeRounding: "down", refundRequests: false, breachLogAccess: false });
});

it("rejects missing, tampered and stale signatures before processing", () => {
  const secret = "local-connect-signing-secret", timestamp = 5000;
  const body = Buffer.from('{"id":"evt_synthetic"}');
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  const header = `t=${timestamp},v1=${digest}`;
  expect(validConnectSignature(body, header, secret, timestamp + 300)).toBe(true);
  expect(validConnectSignature(body, header, secret, timestamp + 301)).toBe(false);
  expect(validConnectSignature(body, null, secret, timestamp)).toBe(false);
  expect(validConnectSignature(Buffer.from("{}"), header, secret, timestamp)).toBe(false);
  expect(validConnectSignature(body, `t=0,${header}`, secret, timestamp)).toBe(false);
});

it("keeps the Connect adapter and endpoint offline and SaaS billing separate", async () => {
  expect(CONNECT_LIVE_ENABLED).toBe(false);
  expect(CONNECT_WEBHOOK_SECRET).toBe("STRIPE_CONNECT_WEBHOOK_SECRET");
  expect(stripeConnectAdapter.identity).toBe("stripe_connect");
  await expect(stripeConnectAdapter.accountStatus("acct_fake")).rejects.toThrow("MINISTRY_PAYMENTS_DISABLED");
  expect((await POST(new Request("https://app.example.invalid", { method: "POST", body: "{}" }))).status).toBe(404);
  const saas = await readFile("src/server/payments.ts", "utf8");
  expect(saas).not.toMatch(/ministry-payments|stripe_connect|STRIPE_CONNECT_WEBHOOK_SECRET/i);
  const service = await readFile("src/server/ministry-payments/service.ts", "utf8");
  const webhook = await readFile("src/server/ministry-payments/webhook.ts", "utf8");
  expect(service + webhook).not.toMatch(/dodo|from [^\n]+\/payments["']/i);
});
