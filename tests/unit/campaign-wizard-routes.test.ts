import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), origin: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), save: vi.fn(), finish: vi.fn(), discard: vi.fn(), status: vi.fn(), db: {} }));
vi.mock("@/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/http", () => ({ verifiedUser: mocks.user, verifyOrigin: mocks.origin,
  errorResponse: (error: unknown) => Response.json({ error: "x" }, { status: (error as { status?: number }).status ?? 500 }) }));
vi.mock("@/server/campaign-wizard", () => ({ createDraft: mocks.create, listDrafts: mocks.list, getDraft: mocks.get, saveDraftStep: mocks.save,
  finishDraft: mocks.finish, discardDraft: mocks.discard, setCampaignStatus: mocks.status }));
import { GET as list, POST as create } from "../../src/app/api/workspaces/[tenantId]/campaigns/drafts/route";
import { GET as read, PATCH as patch } from "../../src/app/api/workspaces/[tenantId]/campaigns/drafts/[draftId]/route";
import { POST as finish } from "../../src/app/api/workspaces/[tenantId]/campaigns/drafts/[draftId]/finish/route";
import { POST as discard } from "../../src/app/api/workspaces/[tenantId]/campaigns/drafts/[draftId]/discard/route";
import { POST as status } from "../../src/app/api/workspaces/[tenantId]/campaigns/[campaignId]/status/route";

const params = { tenantId: "t", draftId: "d", campaignId: "c" };
const ctx = { params: Promise.resolve(params) };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue("user-1"); });

it("forwards the verified user and the path scope, never a user id from the request", async () => {
  mocks.list.mockResolvedValue({ drafts: [] }); mocks.get.mockResolvedValue({ id: "d" });
  expect((await list(new Request("https://example.test"), ctx)).headers.get("cache-control")).toBe("private, no-store");
  await read(new Request("https://example.test"), ctx);
  expect(mocks.list).toHaveBeenCalledWith(mocks.db, "user-1", "t"); expect(mocks.get).toHaveBeenCalledWith(mocks.db, "user-1", "t", "d");
});
it("creates with the Idempotency-Key and reports 201 for new and 200 for a replay", async () => {
  mocks.create.mockResolvedValueOnce({ created: true, draft: { id: "d" } }).mockResolvedValueOnce({ created: false, draft: { id: "d" } });
  expect((await create(post({ type: "conference" }, { "Idempotency-Key": "k1" }), ctx)).status).toBe(201);
  expect((await create(post({}, { "Idempotency-Key": "k1" }), ctx)).status).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(mocks.db, "user-1", "t", { type: "conference" }, "k1");
  expect(mocks.origin).toHaveBeenCalledTimes(2);
});
it("every write checks the origin first and passes the body through", async () => {
  mocks.save.mockResolvedValue({}); mocks.finish.mockResolvedValue({}); mocks.discard.mockResolvedValue({}); mocks.status.mockResolvedValue({});
  const body = { version: 2 };
  await patch(post({ ...body, step: "basics", data: {} }), ctx); await finish(post(body), ctx); await discard(post(body), ctx); await status(post({ status: "active" }), ctx);
  expect(mocks.origin).toHaveBeenCalledTimes(4);
  expect(mocks.save).toHaveBeenCalledWith(mocks.db, "user-1", "t", "d", { ...body, step: "basics", data: {} });
  expect(mocks.status).toHaveBeenCalledWith(mocks.db, "user-1", "t", "c", { status: "active" });
});
it("a rejected origin or session never reaches a service, and a stale save is a 409", async () => {
  mocks.origin.mockImplementationOnce(() => { throw Object.assign(new Error("origin"), { status: 403 }); });
  expect((await patch(post({}), ctx)).status).toBe(403);
  mocks.user.mockRejectedValueOnce(Object.assign(new Error("auth"), { status: 401 }));
  expect((await finish(post({}), ctx)).status).toBe(401);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  mocks.save.mockRejectedValueOnce(Object.assign(new Error("stale"), { status: 409 }));
  expect((await patch(post({}), ctx)).status).toBe(409);
});
