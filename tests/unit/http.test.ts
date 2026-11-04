import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: vi.fn() }));
import { errorResponse } from "../../src/server/http";

it("maps direct and Drizzle-wrapped SQL permission failures to 403 without exposing details", async () => {
  for (const error of [{ code: "42501", message: "internal detail" }, { cause: { code: "42501" } }]) {
    const response = errorResponse(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Workspace access denied." });
  }
});
