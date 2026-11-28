import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST as contacts } from "../../src/app/api/workspaces/[tenantId]/contacts/route";
import { POST as campaigns } from "../../src/app/api/workspaces/[tenantId]/campaigns/route";
import { POST as communities } from "../../src/app/api/workspaces/[tenantId]/communities/route";
import { POST as newsletter } from "../../src/app/api/workspaces/[tenantId]/newsletter/campaigns/route";
import { GET as paymentAccount, POST as changePayout } from "../../src/app/api/workspaces/[tenantId]/payments/route";
import { GET as roster, POST as changeRoster } from "../../src/app/api/workspaces/[tenantId]/volunteers/route";
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
const admin = "feature-admin", member = "feature-member", coordinator = "feature-coordinator";
const owner = "feature-owner", outsider = "feature-outsider", wrong = "feature-wrong", viewer = "feature-view";
beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, outsider, wrong, viewer, admin, member, coordinator].map((id) => ({ id, name: id, email: id + "@example.invalid" })));
  tenant = (await createWorkspace(fixture.db, owner, "Example ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, outsider, "Other ministry", "church")).tenantId;
  for (const user of [wrong, viewer, coordinator]) await putMember(fixture.db, owner, tenant, user + "@example.invalid", "viewer");
  await putMember(fixture.db, owner, tenant, admin + "@example.invalid", "admin");
  await putMember(fixture.db, owner, tenant, member + "@example.invalid", "member");
  await changeMemberAccess(fixture.db, owner, tenant, { userId: coordinator, role: "collaborator", grants: { volunteers: "manage" } });
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

function call(handle: typeof changeRoster, actor: string, body?: Record<string, unknown>) {
  return handle(new Request("http://localhost/api/feature?from=2026-11-27&to=2026-11-29", {
    method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-test-user": actor },
    body: body ? JSON.stringify(body) : undefined,
  }), { params: Promise.resolve({ tenantId: tenant }) });
}

it("authorizes volunteer management only for owners, admins and explicit managers", async () => {
  for (const actor of [owner, admin, coordinator]) {
    expect((await call(changeRoster, actor, { action: "role", name: "Synthetic role" })).status).toBe(200);
  }
  for (const actor of [member, viewer, wrong, outsider]) {
    expect((await call(changeRoster, actor, { action: "role", name: "Refused" })).status).toBe(404);
  }
  const role = await (await call(changeRoster, coordinator, { action: "role", name: "Synthetic coordinator role" })).json();
  const slot = await call(changeRoster, coordinator, {
    action: "slot", title: "Synthetic shift", roleId: role.id, needed: 1,
    startsAt: "2026-11-28T10:00:00Z", endsAt: "2026-11-28T11:00:00Z",
  });
  expect(slot.status).toBe(200);
  expect((await call(changeRoster, coordinator, { action: "assign", slotId: (await slot.json()).id, userId: member })).status).toBe(200);
  expect((await call(roster, member)).status).toBe(200);
  expect((await call(roster, wrong)).status).toBe(404);
});

it("keeps admin finance reads and reserves payout-account writes for the owner", async () => {
  vi.stubEnv("HARVEST_SYNTHETIC_MINISTRY_PAYMENTS", "1");
  try {
    const payload = { action: "connect", requestKey: "route-payout-1", legalName: "Synthetic Ministry", country: "US", currency: "USD" };
    for (const actor of [admin, member, wrong, coordinator, outsider]) {
      expect((await call(changePayout, actor, payload)).status).toBe(404);
    }
    const view = await call(paymentAccount, admin);
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({ canManageAccount: false });
    expect((await call(paymentAccount, coordinator)).status).toBe(404);
    expect((await call(changePayout, owner, payload)).status).toBe(200);
  } finally {
    vi.unstubAllEnvs();
  }
});
