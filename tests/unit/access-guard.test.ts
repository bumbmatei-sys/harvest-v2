import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// New migrations must ask public.access_role for a role instead of testing role_id, so grants keep flowing into row-level security.
describe("access_role source guard", () => {
  it("no migration after 0111 tests role_id inline", () => {
    const offenders = readdirSync("drizzle").filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 111)
      .filter((f) => /role_id\s*(IN|=|<>)|bio_role_can\(|newsletter_capability\(role_id/i.test(readFileSync(`drizzle/${f}`, "utf8")) && !/access_role/.test(readFileSync(`drizzle/${f}`, "utf8")));
    expect(offenders).toEqual([]);
  });
});
