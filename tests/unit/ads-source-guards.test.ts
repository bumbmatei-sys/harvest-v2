import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");
const serverFiles = readdirSync(join(__dirname, "../../src/server/ads")).filter(f => f.endsWith(".ts"));
const migration = read("drizzle/0098_ads_server.sql");

it("contains no transport: no fetch, http client, socket or SDK import in the Ads server code", () => {
  for (const file of serverFiles) {
    const source = read(`src/server/ads/${file}`);
    expect(source, file).not.toMatch(/\bfetch\s*\(|node:https?|node:net|from "axios"|XMLHttpRequest|WebSocket/);
  }
});
it("keeps the hard-off constants literal and out of the environment", () => {
  expect(read("src/server/ads/registry.ts")).toMatch(/export const ADS_INTEGRATION_ENABLED = false;/);
  expect(read("src/server/ads/zernio-ads-adapter.ts")).toMatch(/export const ZERNIO_ADS_LIVE_NETWORK = false;/);
  for (const file of serverFiles.filter(f => f !== "gate.ts")) expect(read(`src/server/ads/${file}`), file).not.toMatch(/process\.env/);
});
it("forces row security, avoids current_user policies and fixes the search path on every definer", () => {
  const tables = [...migration.matchAll(/CREATE TABLE "(ads_[a-z_]+)"/g)].map(m => m[1]);
  expect(tables).toHaveLength(15);
  for (const t of tables) expect(migration).toContain(`'${t}'`);
  expect(migration).toContain("FORCE ROW LEVEL SECURITY");
  expect(migration).not.toMatch(/TO current_user|TO %I/);
  expect(migration).toContain("current_user <> ''harvest_app''");
  for (const fn of migration.match(/CREATE FUNCTION[\s\S]*?\$\$;/g) ?? []) if (/SECURITY DEFINER/.test(fn)) expect(fn).toContain("SET search_path = pg_catalog, pg_temp");
  expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.ads_webhook_apply[\s\S]*FROM PUBLIC, harvest_app/);
});
it("references no contact: leads stay in the ads domain until a person reviews them", () => {
  expect(migration).not.toMatch(/contacts|contact_id/i);
  expect(read("src/server/ads/leads.ts")).not.toMatch(/contacts|createContact/);
});
it("sends conversion events and uploads audiences only from the two hard-off services, behind their literal switches", () => {
  for (const file of serverFiles.filter(f => !["fake-provider.ts", "port.ts", "zernio-ads-adapter.ts", "contract.ts", "crm-audiences.ts", "conversions.ts", "http.ts"].includes(f))) {
    expect(read(`src/server/ads/${file}`), file).not.toMatch(/sendConversionEvents\(|uploadAudienceMembers\(|createCustomerListAudience\(/);
  }
  const registry = read("src/server/ads/registry.ts");
  for (const name of ["ADS_AUDIENCE_UPLOAD_ENABLED", "ADS_CONVERSIONS_SEND_ENABLED", "ADS_RESULTS_SYNC_ENABLED"]) expect(registry).toContain(`export const ${name} = false;`);
  expect(read("src/server/ads/crm-audiences.ts")).toContain('adsFeature(deps, "audienceUpload")');
  expect(read("src/server/ads/conversions.ts")).toContain('adsFeature(deps, "conversionsSend")');
  expect(read("src/server/ads/sync-worker.ts")).toContain("ADS_RESULTS_SYNC_ENABLED");
  // Consent decisions come from the one gate, never from a local reading of the ledger.
  for (const file of ["crm-audiences.ts", "conversions.ts"]) expect(read(`src/server/ads/${file}`)).toContain("mayContact(");
});
it("the CRM migration forces row security, fixes search paths, keeps worker functions off the app role and sends no raw identifier", () => {
  const sql = read("drizzle/0104_ads_crm.sql");
  expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  expect(sql).not.toMatch(/TO current_user|TO %I/);
  for (const fn of sql.match(/CREATE FUNCTION[\s\S]*?\$\$;/g) ?? []) if (/SECURITY DEFINER/.test(fn)) expect(fn).toContain("SET search_path = pg_catalog, pg_temp");
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ads_lead_convert[\s\S]*ads_sync_claim[\s\S]*ads_sync_apply[\s\S]*FROM PUBLIC, harvest_app/);
  expect(sql.match(/GRANT EXECUTE ON FUNCTION public\.ads_lead_convert\(uuid\) TO harvest_app;/)).toBeTruthy();
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.ads_sync_claim[\s\S]*TO harvest_worker/);
  expect(sql).not.toMatch(/GRANT[^;]*ads_sync[^;]*harvest_app/);
  // The audience and conversion tables hold counts and one-way digests, never an identifier or a person.
  const tables = sql.match(/CREATE TABLE "ads_(audience_uploads|conversion_sends)"[\s\S]*?\);/g)!.join("");
  expect(tables).not.toMatch(/email|phone|contact_id|hash"/i);
});
