import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: vi.fn() }));
import { errorResponse } from "../../src/server/http";

it("maps direct and Drizzle-wrapped SQL permission failures to 403 without exposing details", async () => {
  for (const error of [{ code: "42501", message: "internal detail" }, { cause: { code: "42501" } }]) {
    const response = errorResponse(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Ministry access denied." });
  }
});

it.each(["40P01", "40001"])("maps direct and wrapped transaction conflict %s to a safe reloadable 409", async (code) => {
  for (const error of [{ code, message: "internal SQL and parameters" }, { cause: { cause: { code } } }]) {
    const response = errorResponse(error);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This record changed since you opened it. Reload to see the latest version, then try again.", details: { reason: "stale" } });
  }
});
