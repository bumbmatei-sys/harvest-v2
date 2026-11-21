import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCrmFormsBoundary, inspectCrmFormsBoundary } from "../../scripts/source-guards";
import { syntheticCrmFormsKey } from "../../src/server/crm-form-mode";
import { GET } from "../../src/app/f/[slug]/route";
import { POST } from "../../src/app/f/[slug]/submit/route";

vi.mock("server-only", () => ({}));
const getDb = vi.hoisted(() => vi.fn());
vi.mock("../../src/db/client", () => ({ getDb }));

const synthetic = {
  NODE_ENV: "development",
  HARVEST_CRM_FORMS: "synthetic",
  HARVEST_CRM_FORMS_TEST_KEY: "2b".repeat(32),
  DATABASE_URL: "postgres://harvest_app@127.0.0.1/harvest_test_forms",
};

afterEach(() => vi.unstubAllEnvs());

describe("Hosted CRM form boundary", () => {
  it("guards the literal hard-off constant, both public routes and owner transitions", () => {
    expect(checkCrmFormsBoundary()).toEqual([]);
    expect(inspectCrmFormsBoundary("src/server/crm-form-mode.ts", "export const CRM_FORMS_PRODUCTION_ENABLED = true;")).toHaveLength(1);
    expect(inspectCrmFormsBoundary("src/app/f/[slug]/route.ts", "export function GET() {}")).toHaveLength(1);
    expect(inspectCrmFormsBoundary("src/server/crm-form-publication.ts", "await lockCrmForm(tx, tenantId, id);")).toHaveLength(1);
  });

  it("requires an explicit local synthetic setup", () => {
    expect(syntheticCrmFormsKey(synthetic)).toBeInstanceOf(Buffer);
    expect(syntheticCrmFormsKey({ ...synthetic, HARVEST_CRM_FORMS: undefined })).toBeNull();
    expect(syntheticCrmFormsKey({ ...synthetic, DATABASE_URL: "postgres://harvest_app@db.example.test/harvest_test_forms" })).toBeNull();
    expect(syntheticCrmFormsKey({ ...synthetic, DATABASE_URL: "postgres://harvest_app@127.0.0.1/harvest" })).toBeNull();
    expect(syntheticCrmFormsKey({ ...synthetic, HARVEST_CRM_FORMS_TEST_KEY: "invalid" })).toBeNull();
  });

  it.each(["NODE_ENV", "VERCEL_ENV", "HARVEST_ENV"])("returns 404 on both Node handlers with %s=production", async (setting) => {
    for (const [name, value] of Object.entries(synthetic)) vi.stubEnv(name, value);
    vi.stubEnv(setting, "production");
    const context = { params: Promise.resolve({ slug: "visitor-card" }) };
    const url = "http://localhost/f/visitor-card";
    const get = await GET(new Request(url), context);
    const post = await POST(new Request(`${url}/submit`, { method: "POST", body: "{" }), context);
    expect([get.status, post.status]).toEqual([404, 404]);
    expect(await get.text()).toEqual(await post.text());
    expect(getDb).not.toHaveBeenCalled();
  });
});
