import { afterEach, expect, it, vi } from "vitest";
import { request } from "../../src/hooks/use-request";
import { message } from "../../src/i18n/messages";

const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
afterEach(() => vi.unstubAllGlobals());

it("returns parsed data on success and sends JSON bodies", async () => {
  respond(200, { id: 1 });
  expect(await request("/api/x", { method: "POST", body: { a: 1 } })).toEqual({ ok: true, data: { id: 1 } });
  const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' });
});
it("maps catalogue errors and hides unknown provider text behind the fallback", async () => {
  respond(400, { error: { message: message("Errors.couldNotConnectPleaseTryAgain") }, details: { field: "name" } });
  expect(await request("/api/x", { method: "PATCH" })).toEqual({ ok: false, status: 400, error: message("Errors.couldNotConnectPleaseTryAgain"), details: { field: "name" } });
  respond(500, { error: "pg: relation missing" });
  const result = await request("/api/x", { method: "GET" });
  expect(result).toMatchObject({ ok: false, status: 500, error: message("Errors.somethingWentWrongPleaseTryAgain") });
});
it("reports 401 status so the hook can redirect", async () => {
  respond(401, {});
  expect(await request("/api/x", { method: "GET" })).toMatchObject({ ok: false, status: 401 });
});
it("returns status 0 on network failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
  expect(await request("/api/x", { method: "GET" })).toEqual({ ok: false, status: 0, error: message("Errors.couldNotConnectPleaseTryAgain") });
});
