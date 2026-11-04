import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createContact, getContact, recordConsent } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenant: string;
const proof = { channel: "email", status: "granted", purpose: "marketing", noticeVersion: "notice-v1", source: "Form", evidence: "Reference" } as const;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values({ id: "consent-owner", name: "Owner", email: "consent-owner@example.test" });
  tenant = (await createWorkspace(fixture.db, "consent-owner", "Consent follow-ups")).tenantId;
});
afterAll(async () => { await fixture?.close(); });

describe("server-owned recording clock and withdrawal precedence", () => {
  it("ignores a client-supplied 2099 recording time and still rejects future occurrence", async () => {
    const contact = await createContact(fixture.db, "consent-owner", tenant, { name: "Untrusted recording clock" });
    await withTenant(fixture.db, "consent-owner", tenant, "contacts:write", async (tx) => {
      const { rows: [row] } = await tx.execute(sql`insert into contact_consents
        (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence,recorded_at,occurred_at)
        values (${tenant},${contact.id},'consent-owner','marketing','notice-v1','email','granted','Form','Reference',
          '2099-01-01T00:00:00Z','2026-10-01T00:00:00Z') returning recorded_at = now() as server_clock`);
      expect(row.server_clock).toBe(true);
    });
    await expect(withTenant(fixture.db, "consent-owner", tenant, "contacts:write", (tx) => tx.execute(sql`insert into contact_consents
      (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence,recorded_at,occurred_at)
      values (${tenant},${contact.id},'consent-owner','marketing','notice-v1','email','granted','Form','Reference',
        '2099-01-01T00:00:00Z','2099-01-01T00:00:00Z')`))).rejects.toMatchObject({ cause: { constraint: "consent_occurrence_bound" } });
    const withdrawal = await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, status: "withdrawn", occurredAt: "2026-10-02T00:00:00Z" });
    expect((await getContact(fixture.db, "consent-owner", tenant, contact.id)).effectiveConsents).toEqual([withdrawal]);
  });

  it.each(["grant first", "withdrawal first"])("keeps withdrawal effective with a backdated grant: %s", async (order) => {
    const contact = await createContact(fixture.db, "consent-owner", tenant, { name: order });
    const grant = { ...proof, occurredAt: "2026-10-01T12:00:00Z" };
    const withdrawal = { ...proof, status: "withdrawn" as const, occurredAt: "2026-10-02T12:00:00Z" };
    const sequence = order === "grant first" ? [grant, withdrawal] : [withdrawal, grant];
    for (const input of sequence) await recordConsent(fixture.db, "consent-owner", tenant, contact.id, input);
    const detail = await getContact(fixture.db, "consent-owner", tenant, contact.id);
    expect(detail.consents.map((row) => row.status)).toEqual(sequence.toReversed().map((input) => input.status));
    expect(detail.effectiveConsents).toEqual([detail.consents.find((event) => event.status === "withdrawn")]);
  });

  it.each([
    ["later on both clocks", "2026-10-02T12:00:00.000000Z", "2026-10-03T12:00:00.000000Z", "2026-10-02T13:00:00Z", "granted"],
    ["same occurrence", "2026-10-02T12:00:00Z", "2026-10-03T12:00:00Z", "2026-10-02T12:00:00Z", "withdrawn"],
    ["same recording", "2026-10-02T12:00:00Z", "2026-10-02T12:00:00Z", "2026-10-02T12:01:00Z", "withdrawn"],
    ["recorded earlier but occurred later", "2026-10-02T12:01:00Z", "2026-10-02T12:00:00Z", "2026-10-02T12:02:00Z", "withdrawn"],
    ["strict sub-millisecond recording", "2026-10-02T12:00:00.000001Z", "2026-10-02T12:00:00.000002Z", "2026-10-02T12:00:00.000001Z", "granted"],
  ])("requires strict precedence on both clocks: %s", async (_label, withdrawalRecorded, grantRecorded, grantOccurred, status) => {
    const contact = await createContact(fixture.db, "consent-owner", tenant, { name: "Clock boundaries" });
    // Controlled historical fixtures keep the app recording clock unforgeable.
    const client = await fixture.admin.connect();
    try {
      await client.query("begin");
      await client.query("alter table contact_consents disable trigger consent_provenance");
      await client.query(`insert into contact_consents
        (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence,recorded_at,occurred_at) values
        ($1,$2,'consent-owner','marketing','notice-v1','email','withdrawn','Form','Reference',$3,'2026-10-02T12:00:00Z'),
        ($1,$2,'consent-owner','marketing','notice-v1','email','granted','Form','Reference',$4,$5)`,
      [tenant, contact.id, withdrawalRecorded, grantRecorded, grantOccurred]);
      await client.query("alter table contact_consents enable trigger consent_provenance");
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    expect((await getContact(fixture.db, "consent-owner", tenant, contact.id)).effectiveConsents[0].status).toBe(status);
  });

  it("requires every withdrawal to be superseded and keeps purposes/channels separate", async () => {
    const contact = await createContact(fixture.db, "consent-owner", tenant, { name: "Multiple withdrawals" });
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, status: "withdrawn", occurredAt: "2026-10-03T12:00:00Z" });
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, status: "withdrawn", occurredAt: "2026-10-01T12:00:00Z" });
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, occurredAt: "2026-10-02T12:00:00Z" });
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, status: "unknown", occurredAt: "2026-10-04T12:00:00Z" });
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, channel: "sms", occurredAt: "2026-10-04T12:00:00Z" });
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, purpose: "event_administration", occurredAt: "2026-10-04T12:00:00Z" });
    let detail = await getContact(fixture.db, "consent-owner", tenant, contact.id);
    const marketing = () => detail.effectiveConsents.find((row) => row.channel === "email" && row.purpose === "marketing");
    expect(marketing()?.status).toBe("withdrawn");
    expect(detail.effectiveConsents.filter((row) => row.status === "granted")).toHaveLength(2);
    await recordConsent(fixture.db, "consent-owner", tenant, contact.id, { ...proof, occurredAt: "2026-10-04T12:00:00Z" });
    detail = await getContact(fixture.db, "consent-owner", tenant, contact.id);
    expect(marketing()?.status).toBe("granted");
  });
});
