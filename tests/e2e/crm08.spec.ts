import { expect, test, type Page } from "@playwright/test";
import { origin, signIn } from "./helpers/session";

// CRM-08 has no new screen: outbound webhooks are an owner/admin API and the assistant tools have no runtime yet.
// This checks the real HTTP routes: session, origin, role, workspace and validation, and that development never
// enables delivery (no signing key is configured, so endpoints cannot be created and nothing is sent).
async function api(page: Page, method: "get" | "post" | "patch" | "put" | "delete", path: string, data?: unknown, headers: Record<string, string> = { origin }) {
  const response = await page.request[method](path, { headers, data });
  return { status: response.status(), body: await response.json().catch(() => ({})), headers: response.headers() };
}

test("CRM-08: webhook endpoint routes enforce session, origin, role and workspace, and stay off in development", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const workspace = await api(page, "post", "/api/workspaces", { name: "CRM-08 routes" });
  expect(workspace.status).toBe(201);
  const root = `/api/workspaces/${workspace.body.tenantId}/crm/webhooks`;
  const listed = await api(page, "get", root);
  expect(listed.status).toBe(200);
  expect(listed.headers["cache-control"]).toContain("no-store");
  expect(listed.body).toMatchObject({ endpoints: [], deliveryEnabled: false });
  expect(listed.body.eventTypes).toEqual(expect.arrayContaining(["crm.person.created", "crm.organization.updated", "crm.deal.stage_changed", "crm.task.completed", "crm.association.recorded"]));
  // Unsafe destinations are refused before anything else; a safe one is refused because no signing key exists here.
  for (const url of ["http://hooks.example.org/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data", "https://localhost/"]) {
    expect((await api(page, "post", root, { url, eventTypes: ["crm.person.created"] })).status, url).toBe(400);
  }
  expect((await api(page, "post", root, { url: "https://hooks.example.org/in", eventTypes: ["crm.person.created"] })).status).toBe(409);
  expect((await api(page, "post", root, { url: "https://hooks.example.org/in", eventTypes: ["crm.person.created"] }, {})).status).toBe(403);
  // Members and other workspaces cannot see or change webhooks.
  const otherContext = await browser.newContext(), other = await otherContext.newPage();
  try {
    const otherEmail = await signIn(other);
    expect((await api(other, "get", root)).status).toBe(403);
    expect((await api(page, "put", `/api/workspaces/${workspace.body.tenantId}/members`, { email: otherEmail, role: "member" })).status).toBe(200);
    expect((await api(other, "get", root)).status).toBe(403);
    expect((await api(other, "post", root, { url: "https://hooks.example.org/in", eventTypes: ["crm.person.created"] })).status).toBe(403);
    expect((await api(other, "delete", `${root}/00000000-0000-4000-8000-000000000000`)).status).toBe(403);
  } finally { await otherContext.close(); }
  expect((await api(page, "get", `${root}/00000000-0000-4000-8000-000000000000/deliveries`)).status).toBe(404);
  const signedOut = await browser.newContext();
  try { expect((await signedOut.request.get(root)).status()).toBe(401); } finally { await signedOut.close(); }
});
