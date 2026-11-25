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
it("never sends conversion events or uploads audiences from the adapter or the services", () => {
  for (const file of serverFiles.filter(f => !["fake-provider.ts", "port.ts", "zernio-ads-adapter.ts", "contract.ts"].includes(f))) {
    expect(read(`src/server/ads/${file}`), file).not.toMatch(/sendConversionEvents|uploadAudience|createAudience/);
  }
});
