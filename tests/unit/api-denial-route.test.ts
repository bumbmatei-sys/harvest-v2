import { expect, it, vi } from "vitest";
import { apiDenialRoute } from "../../src/lib/api-denial-route";

it("only returns fixed route names and parameter placeholders", () => {
  expect(apiDenialRoute("/api/workspaces/ministry@example.invalid/contacts/person@example.invalid/consents"))
    .toBe("/api/workspaces/:tenantId/contacts/:contactId/consents");
  expect(apiDenialRoute("/api/workspaces/private/name@example.invalid")).toBe("/api/workspaces/:tenantId/:area");
  expect(apiDenialRoute("/api/person@example.invalid")).toBe("/api/:route");
  expect(apiDenialRoute("/ordinary-page")).toBeNull();
});

import { AccessError } from "../../src/server/permissions";
import { errorResponse } from "../../src/server/http";

const mock = vi.hoisted(() => ({ route: "", callbacks: [] as Array<() => Promise<void>> }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/auth-instance", () => ({ getAuth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-harvest-api-denial-route": mock.route }) }));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => mock.callbacks.push(callback) }));

it("logs caught 403 responses without the error message or details", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    mock.route = "/api/workspaces/:tenantId/contacts/:contactId/consents";
    expect(errorResponse(new AccessError(403, "person@example.invalid", { person: "private" })).status).toBe(403);
    await mock.callbacks.shift()!();
    expect(log).toHaveBeenCalledExactlyOnceWith({ route: mock.route, reason: "permission_denied" });

    mock.route = "/api/workspaces/id/contacts/person@example.invalid";
    expect(errorResponse({ code: "42501", message: "private" }).status).toBe(403);
    await mock.callbacks.shift()!();
    expect(log).toHaveBeenLastCalledWith({ route: "/api/:route", reason: "row_policy_denied" });
  } finally {
    log.mockRestore();
  }
});
