import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A migration that re-creates the audit_system_actor check must carry every action the LATEST SQL definition allows; building the list from schema.ts alone once dropped an action.
// This guard compares the list in src/db/schema.ts with the constraint as the last migration that touches it defines it.
const actions = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
describe("audit_system_actor", () => {
  it("lists the same actions in src/db/schema.ts and in the latest migration that defines it", () => {
    let latest: string[] | null = null;
    for (const file of readdirSync("drizzle").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      for (const m of readFileSync(`drizzle/${file}`, "utf8").matchAll(/ADD CONSTRAINT "audit_system_actor" CHECK \((.*?)\)(?:;|\n)/g)) latest = actions(m[1].split(" in (")[1] ?? "");
    }
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const start = schema.indexOf('check("audit_system_actor"');
    const inList = schema.slice(start, schema.indexOf("`)", start)).split(" in (")[1] ?? "";
    expect(latest).not.toBeNull();
    expect(actions(inList)).toEqual(latest);
    expect(latest).toContain("bio.message.submit");
  });
});
