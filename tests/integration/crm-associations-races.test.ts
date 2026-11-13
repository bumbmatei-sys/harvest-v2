import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { users } from "../../src/db/schema";
import type { Database } from "../../src/db/client";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, recordConsent } from "../../src/server/contacts";
import { recordAssociation, type AssociationInput } from "../../src/server/crm-associations";

// CRM-07 review nits N1 and N2: races on the association write path. fixture.db has one connection and would
// serialise the calls, so these use a wider pool.
let wide: Pool, wideDb: Database, fixture: Awaited<ReturnType<typeof testDatabase>>, tenant: string, ana: string;
const grant = (contact: string, status: "granted" | "withdrawn", channel: "email" | "social" = "social") =>
  recordConsent(fixture.db, "owner-a", tenant, contact, { channel, status, purpose: "messaging", noticeVersion: "notice-v1", source: `Synthetic ${status}`, evidence: "Synthetic test evidence" });
const message = (overrides: Partial<AssociationInput> = {}): AssociationInput => ({ source: "zernio", kind: "message", purpose: "messaging", contactId: ana, summary: "Synthetic: asked about the youth trip", ...overrides });
const rows = async (externalId: string) => (await fixture.admin.query("select count(*)::int as n from crm_associations where tenant_id = $1 and external_id = $2", [tenant, externalId])).rows[0].n as number;

beforeAll(async () => {
  fixture = await testDatabase();
  wide = new Pool({ connectionString: fixture.appURL, max: 10 });
  wideDb = drizzle(wide, { schema }) as unknown as Database;
  await fixture.db.insert(users).values(["owner-a", "member-a"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, "owner-a", "Association races")).tenantId;
  await putMember(fixture.db, "owner-a", tenant, "member-a@example.test", "member");
  ana = (await createContact(fixture.db, "owner-a", tenant, { name: "Synthetic Ana", email: "ana@example.test" })).id;
  await grant(ana, "granted");
});
afterAll(async () => { await wide?.end(); await fixture?.close(); });

describe("CRM-07 association races", () => {
  it("N1: simultaneous redelivery of one external id stores one row and reports the rest as duplicates", async () => {
    for (let round = 0; round < 5; round++) {
      const externalId = `race-${round}`;
      const results = await Promise.all(Array.from({ length: 4 }, () => recordAssociation(wideDb, "member-a", tenant, message({ externalId }))));
      expect(results.filter((result) => result.stored && !result.duplicate)).toHaveLength(1);
      expect(results.filter((result) => result.stored && result.duplicate)).toHaveLength(3);
      expect(new Set(results.map((result) => result.stored && result.id)).size).toBe(1);
      expect(await rows(externalId)).toBe(1);
    }
  });

  it("N2: a withdrawal committed while an association is being recorded gives consent_withdrawn, never a server error", async () => {
    const holder = await fixture.admin.connect();
    try {
      // Hold the person row as a concurrent withdrawal would, then let a withdrawal land behind it.
      await holder.query("begin");
      await holder.query("select set_config('app.user_id', 'owner-a', true)");
      await holder.query("select 1 from contacts where id = $1 for update", [ana]);
      const pending = recordAssociation(wideDb, "member-a", tenant, message({ externalId: "withdraw-race" })).then((value) => ({ value }), (error: unknown) => ({ error }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await holder.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      await holder.query(`insert into contact_consents (tenant_id, contact_id, channel, purpose, status, notice_version, source, evidence, recorded_by, occurred_at, recorded_at)
        values ($1, $2, 'social', 'messaging', 'withdrawn', 'notice-v1', 'Synthetic withdrawal', 'Synthetic', 'owner-a', now(), now())`, [tenant, ana]);
      await holder.query("commit");
      const outcome = await pending;
      expect(outcome).toEqual({ value: expect.objectContaining({ stored: false, reason: "consent_withdrawn" }) });
    } finally { await holder.query("rollback").catch(() => undefined); holder.release(); }
    // The admin pool has one connection, so this waits until the holder is released.
    expect(await rows("withdraw-race")).toBe(0);
  });
});
