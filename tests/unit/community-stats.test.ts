import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { communityStatsUnavailable } from "../../src/lib/community-stats";

const source = readFileSync(join(__dirname, "../../src/server/community-stats.ts"), "utf8");
it("lists what is never recorded instead of reporting zero", () => {
  expect(communityStatsUnavailable).toEqual(["commerce", "courseProgress", "eventParticipation", "chat"]);
});
it("is read only and never selects a person", () => {
  expect(source).not.toMatch(/\b(insert into|update public|delete from|\.insert\(|\.update\(|\.delete\()/i);
  expect(source).not.toMatch(/select[^;]*\b(email|name)\b/i);
  expect(source).toContain('"communities:manage"');
});
it("builds every query from template parameters, never string interpolation", () => {
  expect(source).not.toMatch(/sql\.raw/);
});

const migration = readFileSync(join(__dirname, "../../drizzle/0101_community_retention.sql"), "utf8");
it("retention migration: forced row security, fixed search paths, no write grant to the application role", () => {
  expect(migration).toContain("FORCE ROW LEVEL SECURITY");
  expect(migration).not.toMatch(/TO current_user|TO %I/);
  expect(migration).toContain("current_user <> ''harvest_app''");
  for (const fn of migration.match(/CREATE FUNCTION[\s\S]*?\$\$;/g) ?? []) if (/SECURITY DEFINER/.test(fn)) expect(fn).toContain("SET search_path = pg_catalog, pg_temp");
  expect(migration).toMatch(/GRANT SELECT ON public\.%I TO harvest_app/);
  expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*community_(exits|daily_counts)/);
  expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.community_stats_can[\s\S]*community_exit_record[\s\S]*FROM PUBLIC, harvest_app/);
  expect(migration).not.toMatch(/ip_address|user_agent|cookie|session_id|referrer/i);
});
it("acquisition counting is hard-off by a literal constant and stores nothing about the visitor", () => {
  const code = readFileSync(join(__dirname, "../../src/server/community-acquisition.ts"), "utf8");
  expect(code).toMatch(/export const COMMUNITY_ACQUISITION_COUNTING_ENABLED = false;/);
  expect(code).not.toMatch(/set-cookie|cookies\(|headers\.get\("(x-forwarded-for|x-real-ip|referer)/i);
  expect(code).not.toMatch(/insert into|\.insert\(/i);
});
