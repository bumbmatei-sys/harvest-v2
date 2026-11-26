import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledConfig, PLACEMENT_REGION, productionConfig } from "../../scripts/cf-prepare-production";

const committedProduction = JSON.parse(readFileSync("cloudflare/production.json", "utf8"));
const committedStaging = JSON.parse(readFileSync("cloudflare/staging.json", "utf8"));
const filled = {
  ...committedProduction,
  CF08_PRODUCTION_ORIGIN: "https://app.harvest-fixture.org",
  CF08_PRODUCTION_HYPERDRIVE_ID: "0123456789abcdef0123456789abcdef",
  CF08_PRODUCTION_EMAIL_FROM: "Harvest <no-reply@harvest-fixture.org>",
};
const staging = { ...committedStaging, CF07_PRODUCTION_ORIGIN: filled.CF08_PRODUCTION_ORIGIN, CF07_PRODUCTION_HYPERDRIVE_ID: filled.CF08_PRODUCTION_HYPERDRIVE_ID };

describe("CF-08 production config", () => {
  it("refuses the committed placeholders", () => {
    expect(() => productionConfig(committedProduction, committedStaging)).toThrow(/CF08_PRODUCTION_ORIGIN/);
    expect(() => productionConfig({ ...committedProduction, CF08_PRODUCTION_ORIGIN: filled.CF08_PRODUCTION_ORIGIN }, staging)).toThrow(/HYPERDRIVE/);
    expect(() => productionConfig({ ...filled, CF08_PRODUCTION_EMAIL_FROM: committedProduction.CF08_PRODUCTION_EMAIL_FROM }, staging)).toThrow(/EMAIL_FROM/);
  });

  it("refuses staging resources, workers.dev and test hosts", () => {
    for (const origin of [committedStaging.CF07_STAGING_ORIGIN, "https://harvest.bumbmatei-bee.workers.dev", "https://app.example.com", "https://x.test", "http://app.harvest-fixture.org", "https://app.harvest-fixture.org/path"]) {
      expect(() => productionConfig({ ...filled, CF08_PRODUCTION_ORIGIN: origin }, { ...staging, CF07_PRODUCTION_ORIGIN: origin })).toThrow();
    }
    expect(() => productionConfig({ ...filled, CF08_PRODUCTION_HYPERDRIVE_ID: committedStaging.CF07_STAGING_HYPERDRIVE_ID }, { ...staging, CF07_PRODUCTION_HYPERDRIVE_ID: committedStaging.CF07_STAGING_HYPERDRIVE_ID })).toThrow();
    expect(() => productionConfig({ ...filled, CF08_PRODUCTION_BUCKET: committedStaging.CF07_STAGING_BUCKET }, staging)).toThrow(/bucket/);
    expect(() => productionConfig({ ...filled, CF08_PRODUCTION_WORKER: committedStaging.CF07_STAGING_WORKER }, staging)).toThrow(/name/);
  });

  it("requires staging.json to guard against the same production resources", () => {
    expect(() => productionConfig(filled, committedStaging)).toThrow(/staging\.json/);
  });

  it("builds a production-only config", () => {
    const config = productionConfig(filled, staging);
    expect(config.vars).toMatchObject({ HARVEST_ENV: "production", BETTER_AUTH_URL: filled.CF08_PRODUCTION_ORIGIN, HARVEST_PRODUCTION_ORIGIN: filled.CF08_PRODUCTION_ORIGIN });
    expect(config).toMatchObject({ workers_dev: false, preview_urls: false, placement: { region: PLACEMENT_REGION }, upload_source_maps: false });
    expect(config).not.toHaveProperty("services");
    expect(config).not.toHaveProperty("routes");
    expect(config.alias).toEqual({ "server-only": "./server-only.mjs" });
    expect(JSON.stringify(config)).not.toMatch(/staging|mailbox|example\.invalid/);
    const bundled = bundledConfig(config);
    expect(bundled).toMatchObject({ main: "app-worker.js", no_bundle: true, assets: { directory: "./assets" } });
    expect(bundled).not.toHaveProperty("alias");
  });
});
