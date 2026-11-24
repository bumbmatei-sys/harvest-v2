import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { syntheticProviderActive } from "../../src/server/newsletter-campaigns/provider-mode";

const migrations = readdirSync("drizzle").filter(name => name.endsWith(".sql")).map(name => [name, readFileSync("drizzle/" + name, "utf8")] as const);

it("keeps the web-callable domain verification synthetic-only", () => {
  const definers = migrations.filter(([, sql]) => /FUNCTION public\.newsletter_verify_domain/.test(sql));
  expect(definers.map(([name]) => name)).toEqual(["0087_newsletter_sender.sql"]);
  const sql = definers[0][1];
  // Removing or relaxing this clause must come with a review of the web grant (it must move to the worker path before a live adapter).
  expect(sql).toContain("current_domain ~ '[.]example[.]test$'");
  expect(sql).toContain("current_domain<>'newsletter.example.test'");
  expect(sql).toContain("SYNTHETIC-ONLY");
  expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.newsletter_verify_domain");
  expect(sql).toMatch(/GET DIAGNOSTICS updated=ROW_COUNT;\s*PERFORM set_config[\s\S]*RETURN updated>0;/);
  expect(readFileSync("docs/runbooks/newsletter-activation.md", "utf8")).toContain("newsletter_verify_domain");
  expect(readFileSync("docs/acceptance/newsletter-sender.md", "utf8")).toContain("SYNTHETIC-ONLY");
});

it("serves verification and the test mailbox only with the synthetic provider", () => {
  expect(syntheticProviderActive({ NODE_ENV: "test" })).toBe(true);
  expect(syntheticProviderActive({ NODE_ENV: "test", HARVEST_NEWSLETTER_PROVIDER: "synthetic" })).toBe(true);
  expect(syntheticProviderActive({ NODE_ENV: "test", HARVEST_NEWSLETTER_PROVIDER: "ses" })).toBe(false);
  expect(syntheticProviderActive({ NODE_ENV: "production" })).toBe(false);
});
