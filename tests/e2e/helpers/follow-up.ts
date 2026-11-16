import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { origin, signIn } from "./session";

// Seeds follow-up cases for the browser tests through the real paths: ministry, campaign, form and link through the API; each request through
// the public intake page; the association (a verified claim in production, which HC-06 owns) through the local admin connection with the
// response guard briefly disabled, exactly as the HC-13 integration fixture does; consent through the CRM ledger API; cases through the real
// "open cases" endpoint. Synthetic data only; nothing is sent.
export async function api(page: Page, method: "get" | "post" | "put" | "patch", path: string, data?: unknown) {
  const response = await page.request[method](path, { headers: { origin, ...(method === "post" && path.endsWith("/campaigns") ? { "Idempotency-Key": randomUUID() } : {}) }, data });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}

/** Admin connection to this run's disposable database. Needs the local TEST_DATABASE_URL used by CI and the documented local setup. */
export async function adminClient() {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return null;
  const app = new URL((await readFile(`${process.env.HARVEST_E2E_MAILBOX}.database`, "utf8")).trim());
  const url = new URL(admin); url.pathname = app.pathname;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

export type SeededCase = { id: string; person: string; contactId: string };
export async function seedFollowUp(owner: Page, browser: Browser, people: string[]) {
  const admin = await adminClient();
  if (!admin) throw new Error("TEST_DATABASE_URL is required to seed follow-up cases");
  try {
    const workspace = await api(owner, "post", "/api/workspaces", { audience: "church", name: "Harvest Kit PR6 ministry" });
    const tenantId = workspace.body.tenantId as string, root = `/workspaces/${tenantId}`, apiRoot = `/api${root}`;
    const campaign = (await api(owner, "post", `${apiRoot}/campaigns`, { name: "Synthetic follow-up crusade", type: "conference" })).body.id as string;
    const connect = `${apiRoot}/campaigns/${campaign}/connect`;
    const form = await api(owner, "post", `${connect}/forms`, { name: "Synthetic request", notice: "Synthetic choices", retentionDays: 7, purposes: ["outreach_follow_up", "newsletter", "account_communications"],
      definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: true, followUpChannel: "email" } });
    expect(form.status).toBe(201);
    const link = (await api(owner, "post", `${connect}/links`, { label: "Synthetic desk", formVersionId: form.body.id })).body;
    expect((await api(owner, "post", `${connect}/links/${link.id}/actions`, { action: "publish" })).status).toBe(200);

    const seeded: SeededCase[] = [];
    for (const [index, person] of people.entries()) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      try {
        const visitor = await context.newPage();
        await visitor.goto(`/s/${link.shortCode}`);
        await visitor.getByRole("checkbox", { name: "I would like pastoral follow-up", exact: true }).check();
        await visitor.getByLabel("Email", { exact: true }).fill(`follow-${index}-${randomUUID().slice(0, 6)}@example.test`);
        await visitor.getByRole("button", { name: "Save test request", exact: true }).click();
        await expect(visitor.getByRole("heading", { name: "Test request saved", exact: true })).toBeVisible();
      } finally { await context.close(); }
      const contact = await api(owner, "post", `${apiRoot}/contacts`, { name: person, email: `crm-${index}-${randomUUID().slice(0, 6)}@example.test` });
      expect(contact.status).toBe(201);
      const response = (await admin.query("select id from campaign_responses where tenant_id = $1 and contact_id is null and status <> 'associated' order by submitted_at, id limit 1", [tenantId])).rows[0]?.id as string;
      expect(response).toBeTruthy();
      await admin.query("alter table campaign_responses disable trigger campaign_response_guard");
      try { await admin.query("update campaign_responses set status = 'associated', contact_id = $2, associated_at = now() where id = $1", [response, contact.body.id]); }
      finally { await admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
      const consent = await api(owner, "post", `${apiRoot}/contacts/${contact.body.id}/consents`, { channel: "email", status: "granted", purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Synthetic form", evidence: "Synthetic explicit choice", occurredAt: new Date(Date.now() - 120_000).toISOString() });
      expect(consent.status).toBe(201);
      seeded.push({ id: "", person, contactId: contact.body.id });
    }
    const opened = await api(owner, "post", `${apiRoot}/followup-cases`, { limit: 200 });
    expect(opened.status).toBe(200);
    expect(opened.body.opened).toBe(people.length);
    const list = await api(owner, "get", `${apiRoot}/followup-cases`);
    for (const item of list.body.items as { id: string; contactId: string }[]) { const match = seeded.find((entry) => entry.contactId === item.contactId); if (match) match.id = item.id; }
    return { tenantId, root, apiRoot, cases: seeded };
  } finally { await admin.end(); }
}

export async function addMember(owner: Page, browser: Browser, role: "admin" | "member" | "viewer", tenantApi: string, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  const email = await signIn(page);
  expect((await api(owner, "put", `${tenantApi}/members`, { email, role })).status).toBe(200);
  return { page, context, email };
}
