import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST as contacts } from "../../src/app/api/workspaces/[tenantId]/contacts/route";
import { POST as campaigns } from "../../src/app/api/workspaces/[tenantId]/campaigns/route";
import { POST as communities } from "../../src/app/api/workspaces/[tenantId]/communities/route";
import { POST as newsletter } from "../../src/app/api/workspaces/[tenantId]/newsletter/campaigns/route";
import { POST as social } from "../../src/app/api/workspaces/[tenantId]/social/drafts/route";
import { users } from "../../src/db/schema";
import { changeMemberAccess } from "../../src/server/access";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { testDatabase } from "../database";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => fixture.db }));
vi.mock("@/server/http", async (actual) => ({
  ...await actual<typeof import("../../src/server/http")>(),
  verifyOrigin: () => {},
  verifiedUser: async (request: Request) => request.headers.get("x-test-user"),
  verifiedSessionUser: async (request: Request) => ({ id: request.headers.get("x-test-user") }),
}));

const routes = [
  { feature: "crm", handle: contacts, body: { name: "Example person", email: "contact@example.invalid", notes: "" } },
  { feature: "campaigns", handle: campaigns, body: { name: "Example campaign", type: "conference" } },
  { feature: "communities", handle: communities, body: { name: "Example community", slug: "example-community" } },
  { feature: "newsletter", handle: newsletter, body: {} },
  { feature: "social", handle: social, body: {} },
];
let tenant: string, elsewhere: string;
const owner = "feature-owner", outsider = "feature-outsider", wrong = "feature-wrong", viewer = "feature-view";
beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, outsider, wrong, viewer].map((id) => ({ id, name: id, email: id + "@example.invalid" })));
  tenant = (await createWorkspace(fixture.db, owner, "Example ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, outsider, "Other ministry", "church")).tenantId;
  for (const user of [wrong, viewer]) await putMember(fixture.db, owner, tenant, user + "@example.invalid", "viewer");
  await changeMemberAccess(fixture.db, owner, tenant, { userId: wrong, role: "collaborator", grants: { office: "manage" } });
  await changeMemberAccess(fixture.db, owner, tenant, { userId: viewer, role: "collaborator",
    grants: { crm: "view", campaigns: "view", communities: "view", newsletter: "view", social: "view" } });
}, 60_000);
afterAll(async () => { await fixture?.close(); });

it.each(routes)("denies out-of-scope $feature writes at the route", async ({ handle, body }) => {
  for (const [workspace, actor] of [[elsewhere, owner], [tenant, wrong], [tenant, viewer]]) {
    const response = await handle(new Request("http://localhost/api/feature", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "fake-request", "x-test-user": actor },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ tenantId: workspace }) });
    expect([403, 404]).toContain(response.status);
  }
});
