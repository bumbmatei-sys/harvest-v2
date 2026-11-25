import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { communityStatsUnavailable } from "../../src/lib/community-stats";

const source = readFileSync(join(__dirname, "../../src/server/community-stats.ts"), "utf8");
it("lists what is never recorded instead of reporting zero", () => {
  expect(communityStatsUnavailable).toEqual(["acquisition", "retention", "commerce", "courseProgress", "eventParticipation", "chat"]);
});
it("is read only and never selects a person", () => {
  expect(source).not.toMatch(/\b(insert into|update public|delete from|\.insert\(|\.update\(|\.delete\()/i);
  expect(source).not.toMatch(/select[^;]*\b(email|name|user_id)\b/i);
  expect(source).toContain('"communities:manage"');
});
it("builds every query from template parameters, never string interpolation", () => {
  expect(source).not.toMatch(/sql\.raw/);
});
