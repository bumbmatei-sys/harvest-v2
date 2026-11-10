import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
const consume = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: () => ({ api: { getSession: async () => ({ user: { id: "guest", email: "guest@example.test", emailVerified: true } }) } }) }));
vi.mock("../../src/db/client", () => ({ getDb: () => ({}) }));
vi.mock("../../src/server/connect-invitations", () => ({ consumeInvitation: consume, requestInvitation: vi.fn(), prepareInvitation: vi.fn(), readInvitationFlow: vi.fn() }));
import { invitationFlowCookie, invitationHttp } from "../../src/server/connect-invitation-http";
import { AccessError } from "../../src/server/permissions";

const claim = (action: "confirm" | "decline") => invitationHttp(new Request("http://127.0.0.1:3100/api/connect/invitations/claim", {
  method: "POST", headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify({ action }),
}), "claim");
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64)); vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3100"); vi.stubEnv("DATABASE_URL", "postgres://harvest_app:test@127.0.0.1/harvest_test_unit");
  jar.get.mockReturnValue({ value: "f".repeat(43) }); jar.delete.mockReset(); consume.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it("clears the claim cookie once a claim is confirmed or declined", async () => {
  for (const action of ["confirm", "decline"] as const) {
    jar.delete.mockReset(); consume.mockResolvedValueOnce({ next: "/account/welcome" });
    const response = await claim(action);
    expect(response.status).toBe(200);
    expect(jar.delete).toHaveBeenCalledWith(invitationFlowCookie);
  }
});

it("keeps the claim cookie when the claim fails so the guest can retry", async () => {
  consume.mockRejectedValueOnce(new AccessError(409, "mismatch", { reason: "mismatch" }));
  expect((await claim("confirm")).status).toBe(409);
  consume.mockRejectedValueOnce(new Error("serialization failure"));
  expect((await claim("confirm")).status).toBe(500);
  expect(jar.delete).not.toHaveBeenCalled();
});
