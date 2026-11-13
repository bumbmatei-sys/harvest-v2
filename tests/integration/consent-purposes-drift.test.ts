import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { associationConsentPurposes, connectOfferedPurposes, connectProjectedPurposes, ledgerPurposes } from "../../src/lib/consent-purposes";

// HC-DEC1: the live database must list exactly the purposes the registry lists. Adding a purpose to the registry
// without the migration that widens these constraints and the Connect functions fails here, and so does the reverse.
let f: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { f = await testDatabase(); });
afterAll(async () => { await f?.close(); });

const sorted = (list: readonly string[]) => [...list].sort();
const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
async function constraint(table: string, name: string) {
  const { rows } = await f.admin.query<{ def: string }>(
    "select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = $1 and c.conname = $2", [table, name]);
  expect(rows, `${table}.${name} exists`).toHaveLength(1);
  return rows[0].def;
}
async function source(fn: string) {
  const { rows } = await f.admin.query<{ src: string }>("select prosrc as src from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace", [fn]);
  expect(rows, `${fn} exists`).toHaveLength(1);
  return rows[0].src;
}

it("keeps the ledger, association and Connect check constraints equal to the registry", async () => {
  expect(sorted(quoted(await constraint("contact_consents", "consent_purpose")))).toEqual(sorted(ledgerPurposes));
  expect(sorted(quoted(await constraint("crm_associations", "crm_association_purpose")))).toEqual(sorted(associationConsentPurposes));
  expect(sorted(quoted(await constraint("form_versions", "form_version_purposes")))).toEqual(sorted(connectOfferedPurposes));
  expect(sorted(quoted(await constraint("campaign_response_consents", "campaign_response_consent_purpose")))).toEqual(sorted(connectOfferedPurposes));
});

it("logs Connect withdrawal events only for the purposes projected to the CRM ledger", async () => {
  const def = await constraint("connect_intake_events", "connect_intake_event_purpose");
  const withdraw = def.slice(def.indexOf("'withdraw'"), def.indexOf(") OR"));
  expect(sorted(quoted(withdraw.replace("'withdraw'", "").replace(/'withdraw'/g, "")).filter((p) => p !== "withdraw"))).toEqual(sorted(connectProjectedPurposes));
});

it("keeps the Connect functions' purpose lists equal to the registry", async () => {
  // Withdrawal accepts exactly the offered purposes.
  const rights = await source("connect_intake_rights");
  const inList = rights.match(/p_purpose IN \(([^)]*)\)/);
  expect(inList, "withdraw purpose list").not.toBeNull();
  expect(sorted(quoted(inList![1]))).toEqual(sorted(connectOfferedPurposes));
  // The source resolver and submit function must name every offered purpose (and no purpose the registry lacks).
  const known = new Set<string>(ledgerPurposes);
  for (const name of ["connect_intake_source", "submit_connect_intake"]) {
    const body = await source(name);
    const named = new Set(quoted(body).filter((item) => known.has(item)));
    expect(sorted([...named]), name).toEqual(sorted(connectOfferedPurposes));
  }
  // Only the projected purposes are copied to the CRM ledger on association and withdrawal.
  const associate = await source("connect_associate_verified");
  expect(sorted([...new Set(quoted(associate).filter((item) => known.has(item)))]), "connect_associate_verified").toEqual(sorted(connectProjectedPurposes));
  const project = await source("connect_project_withdrawal");
  expect(sorted([...new Set(quoted(project).filter((item) => known.has(item)))]), "connect_project_withdrawal").toEqual(sorted(connectProjectedPurposes));
});
