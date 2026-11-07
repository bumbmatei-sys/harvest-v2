import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { crmWebhookDeliveries, crmWebhookEndpoints, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact } from "../../src/server/contacts";
import { createCompany } from "../../src/server/companies";
import { createWebhookEndpoint, deleteWebhookEndpoint, fanOutWebhookDeliveries, listWebhookDeliveries, listWebhookEndpoints, runWebhookDeliveries, updateWebhookEndpoint, MAX_ENDPOINTS_PER_WORKSPACE } from "../../src/server/crm-webhooks";
import { crmEnvelope } from "../../src/server/crm-events";
import { drainJobs } from "../../src/server/jobs/service";
import { endpointSecret, signDelivery, TransportError, type Transport, type TransportRequest } from "../../src/server/webhooks/destination";
import { withTenant } from "../../src/server/tenancy";

const KEY = "test-signing-key-".padEnd(48, "x");
let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string;
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
function recorder(status: number | (() => Promise<number>) = 204) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (request) => { calls.push(request); return { status: typeof status === "number" ? status : await status() } };
  return { calls, transport };
}
const deliveries = async (tenant: string) => (await fixture.admin.query("select * from crm_webhook_deliveries where tenant_id = $1 order by created_at, id", [tenant])).rows;
const makeDue = (tenant: string) => fixture.admin.query("update crm_webhook_deliveries set next_attempt_at = now() where tenant_id = $1 and status = 'pending'", [tenant]);
const run = (tenant: string, options: Parameters<typeof runWebhookDeliveries>[3] = {}) =>
  runWebhookDeliveries(fixture.db, "owner-a", tenant, { enabled: true, signingKey: KEY, resolve: publicDns, ...options });

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "admin-a", "member-a", "viewer-a", "owner-b"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "CRM-08 hooks A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "CRM-08 hooks B")).tenantId;
  await putMember(fixture.db, "owner-a", tenantA, "admin-a@example.test", "admin");
  await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "member");
  await putMember(fixture.db, "owner-a", tenantA, "viewer-a@example.test", "viewer");
});
afterAll(async () => { await fixture?.close(); });

describe("tables and access", () => {
  it("forces RLS with minimal grants and reads nothing without a tenant context", async () => {
    await createWebhookEndpoint(fixture.db, "owner-a", tenantA, { url: "https://hooks.example.org/rls", eventTypes: ["crm.person.created"] }, KEY);
    for (const [table, expected] of [["crm_webhook_endpoints", ["DELETE", "INSERT", "SELECT", "UPDATE"]], ["crm_webhook_deliveries", ["INSERT", "SELECT", "UPDATE"]], ["ai_tool_approvals", ["INSERT", "SELECT", "UPDATE"]]] as const) {
      expect((await fixture.admin.query("select relforcerowsecurity from pg_class where relname = $1", [table])).rows[0].relforcerowsecurity, table).toBe(true);
      const grants = await fixture.admin.query("select privilege_type from information_schema.role_table_grants where grantee = 'harvest_app' and table_name = $1 order by 1", [table]);
      expect(grants.rows.map((row) => row.privilege_type), table).toEqual(expected);
    }
    await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', '', true), set_config('app.user_id', 'owner-a', true)`);
      expect(await tx.select().from(crmWebhookEndpoints)).toEqual([]);
      expect(await tx.select().from(crmWebhookDeliveries)).toEqual([]);
    });
    expect(await fixture.db.select().from(crmWebhookEndpoints)).toEqual([]);
  });

  it("lets owners and admins manage endpoints; members, viewers and other workspaces cannot", async () => {
    const created = await createWebhookEndpoint(fixture.db, "admin-a", tenantA, { url: "https://hooks.example.org/admin", eventTypes: ["crm.deal.stage_changed"] }, KEY);
    expect(created.secret).toBe(endpointSecret(KEY, tenantA, created.endpoint.id, 1));
    const listed = await listWebhookEndpoints(fixture.db, "owner-a", tenantA);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(listed.endpoints.map((endpoint) => endpoint.id)).toContain(created.endpoint.id);
    for (const user of ["member-a", "viewer-a"]) {
      await expect(listWebhookEndpoints(fixture.db, user, tenantA)).rejects.toMatchObject({ status: 403 });
      await expect(createWebhookEndpoint(fixture.db, user, tenantA, { url: "https://hooks.example.org/x", eventTypes: ["crm.person.created"] }, KEY)).rejects.toMatchObject({ status: 403 });
    }
    // Another workspace: forbidden by membership; its endpoint ids are not found from here.
    await expect(listWebhookEndpoints(fixture.db, "owner-b", tenantA)).rejects.toMatchObject({ status: 403 });
    const foreign = await createWebhookEndpoint(fixture.db, "owner-b", tenantB, { url: "https://hooks.example.org/b", eventTypes: ["crm.person.created"] }, KEY);
    await expect(updateWebhookEndpoint(fixture.db, "owner-a", tenantA, foreign.endpoint.id, { version: 1, status: "disabled" }, KEY)).rejects.toMatchObject({ status: 404 });
    await expect(deleteWebhookEndpoint(fixture.db, "owner-a", tenantA, foreign.endpoint.id)).rejects.toMatchObject({ status: 404 });
    await expect(listWebhookDeliveries(fixture.db, "owner-a", tenantA, foreign.endpoint.id)).rejects.toMatchObject({ status: 404 });
    // Rotation returns a new secret once; deleting removes it.
    const rotated = await updateWebhookEndpoint(fixture.db, "owner-a", tenantA, created.endpoint.id, { version: 1, rotateSecret: true }, KEY);
    expect(rotated.secret).toBe(endpointSecret(KEY, tenantA, created.endpoint.id, 2));
    expect(rotated.secret).not.toBe(created.secret);
    expect(await deleteWebhookEndpoint(fixture.db, "owner-a", tenantA, created.endpoint.id)).toEqual({ deleted: true });
    // The ledger records the host, never the path or query.
    const audit = (await fixture.admin.query("select metadata from audit_logs where tenant_id = $1 and action like 'crm.webhook_%'", [tenantA])).rows;
    expect(audit.every((row) => row.metadata.host === "hooks.example.org")).toBe(true);
  });

  it("refuses unsafe destinations, unknown event types, a missing signing key and more than 10 endpoints", async () => {
    for (const url of ["http://hooks.example.org/", "https://127.0.0.1/", "https://169.254.169.254/latest", "https://localhost/", "https://user:pw@hooks.example.org/", "https://hooks.example.org:8080/", "https://metadata.google.internal/"]) {
      await expect(createWebhookEndpoint(fixture.db, "owner-a", tenantA, { url, eventTypes: ["crm.person.created"] }, KEY), url).rejects.toMatchObject({ status: 400 });
    }
    await expect(createWebhookEndpoint(fixture.db, "owner-a", tenantA, { url: "https://hooks.example.org/", eventTypes: ["crm.person.deleted"] }, KEY)).rejects.toThrow();
    await expect(createWebhookEndpoint(fixture.db, "owner-a", tenantA, { url: "https://hooks.example.org/", eventTypes: ["crm.person.created", "crm.person.created"] }, KEY)).rejects.toThrow();
    await expect(createWebhookEndpoint(fixture.db, "owner-a", tenantA, { url: "https://hooks.example.org/", eventTypes: ["crm.person.created"] }, null)).rejects.toMatchObject({ status: 409 });
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 limit")).tenantId;
    for (let i = 0; i < MAX_ENDPOINTS_PER_WORKSPACE; i++) await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: `https://hooks.example.org/${i}`, eventTypes: ["crm.person.created"] }, KEY);
    await expect(createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/11", eventTypes: ["crm.person.created"] }, KEY)).rejects.toMatchObject({ status: 409 });
  });
});

describe("fan-out and delivery", () => {
  it("queues one delivery per subscribed endpoint, idempotently, and sends nothing while delivery is off", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 fanout")).tenantId;
    const people = await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/people", eventTypes: ["crm.person.created", "crm.person.updated"] }, KEY);
    await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/deals", eventTypes: ["crm.deal.created"] }, KEY);
    const disabled = await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/off", eventTypes: ["crm.person.created"] }, KEY);
    await updateWebhookEndpoint(fixture.db, "owner-a", tenant, disabled.endpoint.id, { version: 1, status: "disabled" }, KEY);
    await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Fanout" });
    await createCompany(fixture.db, "owner-a", tenant, { name: "Synthetic Unsubscribed Org" });
    await drainJobs(fixture.db, "owner-a", tenant, "test");
    const rows = await deliveries(tenant);
    expect(rows.map((row) => [row.endpoint_id, row.event_type, row.status])).toEqual([[people.endpoint.id, "crm.person.created", "pending"]]);
    // A replayed or retried event job creates no second delivery.
    const [event] = (await fixture.admin.query("select * from outbox_events where id = $1", [rows[0].event_id])).rows;
    const envelope = crmEnvelope({ id: event.id, kind: event.kind, tenantId: event.tenant_id, createdAt: event.created_at, payload: event.payload })!;
    expect(await withTenant(fixture.db, "owner-a", tenant, "jobs:operate", (tx) => fanOutWebhookDeliveries(tx, envelope))).toBe(0);
    expect(await deliveries(tenant)).toHaveLength(1);
    // Delivery off (the development default): nothing is claimed or sent.
    const { calls, transport } = recorder();
    expect(await runWebhookDeliveries(fixture.db, "owner-a", tenant, { transport, resolve: publicDns, signingKey: KEY, enabled: false })).toMatchObject({ disabled: true, attempted: 0 });
    expect(await runWebhookDeliveries(fixture.db, "owner-a", tenant, { transport, resolve: publicDns, signingKey: null, enabled: true })).toMatchObject({ disabled: true });
    expect(calls).toHaveLength(0);
    expect((await deliveries(tenant))[0]).toMatchObject({ status: "pending", attempts: 0 });
    // Only operators (owner/admin) run deliveries.
    await expect(runWebhookDeliveries(fixture.db, "member-a", tenant, { transport, enabled: true, signingKey: KEY })).rejects.toMatchObject({ status: 403 });
  });

  it("sends a signed envelope to the checked address with a stable event id, then records success without URL or body", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 send")).tenantId;
    const hook = await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/in?token=abc", eventTypes: ["crm.person.created"] }, KEY);
    const person = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic SECRET-NAME", email: "sent@example.test" });
    await drainJobs(fixture.db, "owner-a", tenant, "test");
    const { calls, transport } = recorder(200);
    expect(await run(tenant, { transport, now: () => new Date("2026-11-07T10:00:00Z") })).toMatchObject({ disabled: false, attempted: 1, succeeded: 1 });
    const [request] = calls;
    const [event] = (await fixture.admin.query("select id, created_at from outbox_events where tenant_id = $1 and kind = 'crm.person.created'", [tenant])).rows;
    expect(request.address).toBe("93.184.216.34");
    expect(request.url.toString()).toBe("https://hooks.example.org/in?token=abc");
    expect(request.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(JSON.parse(request.body)).toEqual({ id: event.id, type: "crm.person.created", version: 1, tenantId: tenant, occurredAt: new Date(event.created_at).toISOString(), data: { actorId: "owner-a", contactId: person.id } });
    expect(request.body).not.toContain("SECRET-NAME");
    expect(request.headers).toMatchObject({ "content-type": "application/json", "harvest-event-id": event.id, "harvest-event-type": "crm.person.created", "harvest-timestamp": "1794045600" });
    expect(request.headers["harvest-signature"]).toBe(signDelivery(hook.secret, event.id, "1794045600", request.body));
    const listed = await listWebhookDeliveries(fixture.db, "owner-a", tenant, hook.endpoint.id);
    expect(listed.deliveries[0]).toMatchObject({ status: "succeeded", attempts: 1, lastStatusCode: 200, lastError: null });
    expect(JSON.stringify(listed)).not.toMatch(/token=abc|hooks\.example\.org|SECRET/);
    // Nothing is sent twice.
    expect(await run(tenant, { transport })).toMatchObject({ attempted: 0 });
    expect(calls).toHaveLength(1);
  });

  it("retries failures with backoff and the same event id, then dead-letters; redirects and timeouts are failures", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 retry")).tenantId;
    await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/flaky", eventTypes: ["crm.person.created"] }, KEY);
    await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Retry" });
    await drainJobs(fixture.db, "owner-a", tenant, "test");
    await fixture.admin.query("update crm_webhook_deliveries set max_attempts = 4 where tenant_id = $1", [tenant]);
    const outcomes = [500, 302, -1, 503];
    const { calls, transport } = recorder(async () => { const next = outcomes.shift()!; if (next === -1) throw new TransportError("TIMEOUT"); return next; });
    const history: { status: string; attempts: number; last_error: string; last_status_code: number | null }[] = [];
    for (let i = 0; i < 4; i++) {
      await run(tenant, { transport });
      const [row] = await deliveries(tenant);
      history.push({ status: row.status, attempts: row.attempts, last_error: row.last_error, last_status_code: row.last_status_code });
      if (row.status === "pending") {
        expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
        expect(await run(tenant, { transport })).toMatchObject({ attempted: 0 }); // not due yet
        await makeDue(tenant);
      }
    }
    expect(history).toEqual([
      { status: "pending", attempts: 1, last_error: "HTTP_STATUS", last_status_code: 500 },
      { status: "pending", attempts: 2, last_error: "REDIRECT", last_status_code: 302 },
      { status: "pending", attempts: 3, last_error: "TIMEOUT", last_status_code: null },
      { status: "dead", attempts: 4, last_error: "HTTP_STATUS", last_status_code: 503 },
    ]);
    expect(new Set(calls.map((call) => call.headers["harvest-event-id"])).size).toBe(1);
    expect(await run(tenant, { transport })).toMatchObject({ attempted: 0 });
  });

  it("never calls a destination that resolves to a private or metadata address (checked on every attempt)", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 ssrf")).tenantId;
    await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://rebind.example.org/x", eventTypes: ["crm.person.created"] }, KEY);
    await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic SSRF" });
    await drainJobs(fixture.db, "owner-a", tenant, "test");
    const { calls, transport } = recorder();
    // Saved while public; now resolves (also) to the cloud metadata address.
    await run(tenant, { transport, resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }] });
    expect(calls).toHaveLength(0);
    expect((await deliveries(tenant))[0]).toMatchObject({ status: "dead", last_error: "BLOCKED_DESTINATION", attempts: 1 });
    // IPv4-mapped IPv6 loopback is refused too.
    await fixture.admin.query("update crm_webhook_deliveries set status = 'pending', attempts = 0, next_attempt_at = now() where tenant_id = $1", [tenant]);
    await run(tenant, { transport, resolve: async () => [{ address: "::ffff:127.0.0.1", family: 6 }] });
    expect(calls).toHaveLength(0);
    expect((await deliveries(tenant))[0]).toMatchObject({ status: "dead", last_error: "BLOCKED_DESTINATION" });
  });

  it("cancels deliveries for disabled endpoints, recovers expired leases, keeps workspaces apart and sends erased ids as null", async () => {
    const tenant = (await createWorkspace(fixture.db, "owner-a", "CRM-08 edges")).tenantId;
    const hook = await createWebhookEndpoint(fixture.db, "owner-a", tenant, { url: "https://hooks.example.org/edges", eventTypes: ["crm.person.created"] }, KEY);
    const person = await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Edge" });
    await drainJobs(fixture.db, "owner-a", tenant, "test");
    // Workspace B's operator pass never touches workspace A's deliveries.
    const other = recorder();
    expect(await runWebhookDeliveries(fixture.db, "owner-b", tenantB, { transport: other.transport, resolve: publicDns, enabled: true, signingKey: KEY })).toMatchObject({ attempted: 0 });
    await expect(runWebhookDeliveries(fixture.db, "owner-b", tenant, { transport: other.transport, enabled: true, signingKey: KEY })).rejects.toMatchObject({ status: 403 });
    // A pass that crashed mid-send leaves a lease; it counts as an attempt and the delivery is retried.
    await fixture.admin.query("update crm_webhook_deliveries set status = 'in_flight', attempts = 1, locked_at = now() - interval '5 minutes', lock_token = gen_random_uuid() where tenant_id = $1", [tenant]);
    await run(tenant, { transport: other.transport });
    expect((await deliveries(tenant))[0]).toMatchObject({ status: "pending", last_error: "LEASE_EXPIRED", attempts: 1 });
    // Erasure before the retry: the body carries no id for the person.
    await eraseContact(fixture.db, "owner-a", tenant, person.id);
    await makeDue(tenant);
    await run(tenant, { transport: other.transport });
    expect(JSON.parse(other.calls[0].body).data.contactId).toBeNull();
    expect(other.calls[0].body).not.toContain(person.id);
    // Disabled endpoint: due deliveries are cancelled, not sent.
    await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Edge Two" });
    await drainJobs(fixture.db, "owner-a", tenant, "test");
    const current = (await listWebhookEndpoints(fixture.db, "owner-a", tenant)).endpoints.find((endpoint) => endpoint.id === hook.endpoint.id)!;
    await updateWebhookEndpoint(fixture.db, "owner-a", tenant, hook.endpoint.id, { version: current.version, status: "disabled" }, KEY);
    await run(tenant, { transport: other.transport });
    expect(other.calls).toHaveLength(1);
    expect((await deliveries(tenant)).at(-1)).toMatchObject({ status: "cancelled", last_error: "ENDPOINT_INACTIVE" });
  });
});
