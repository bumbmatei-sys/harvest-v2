import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSocialBoundary, inspectSocialBoundary } from "../../scripts/source-guards";
import { SOCIAL_INTEGRATION_ENABLED, defaultSocialDeps, getSocialSender } from "../../src/server/social/registry";
import { ZERNIO_LIVE_NETWORK } from "../../src/server/social/zernio-adapter";

describe("social provider boundary", () => {
  it("the repository currently has no violations", () => { expect(checkSocialBoundary()).toEqual([]); });
  it("the hard-disable constants are false (value and source)", () => {
    expect(ZERNIO_LIVE_NETWORK).toBe(false); expect(SOCIAL_INTEGRATION_ENABLED).toBe(false);
    expect(defaultSocialDeps().enabled).toBe(false);
    expect(readFileSync("src/server/social/zernio-adapter.ts", "utf8")).toMatch(/export const ZERNIO_LIVE_NETWORK = false;/);
    expect(readFileSync("src/server/social/registry.ts", "utf8")).toMatch(/export const SOCIAL_INTEGRATION_ENABLED = false;/);
  });
  it("nothing hands out a sender", () => { expect(() => getSocialSender()).toThrow("SOCIAL_SENDING_NOT_AVAILABLE"); });

  const rules = (file: string, source: string) => inspectSocialBoundary(file, source).map((v) => v.rule);
  it("detects the vendor host, client import and adapter import outside their homes", () => {
    expect(rules("src/server/crm.ts", 'const u = "https://zernio.com/api/v1";')).toContain("vendor host outside the adapter");
    expect(rules("src/server/crm.ts", 'import Z from "@zernio/node";')).toContain("vendor HTTP client import outside the adapter");
    expect(rules("src/server/crm.ts", 'import { ZernioAdapter } from "./social/zernio-adapter";')).toContain("adapter imported outside the registry");
    expect(rules("src/server/social/registry.ts", 'import { ZernioAdapter } from "./zernio-adapter";\nexport const SOCIAL_INTEGRATION_ENABLED = false;')).toEqual([]);
    expect(rules("src/server/social/zernio-adapter.ts", 'const b = "https://zernio.com/api/v1"; export const ZERNIO_LIVE_NETWORK = false;')).toEqual([]);
  });
  it("detects a flipped or toggleable kill switch and a network call in the layer", () => {
    expect(rules("src/server/social/zernio-adapter.ts", "export const ZERNIO_LIVE_NETWORK = true;")).toContain("ZERNIO_LIVE_NETWORK must be the literal constant false");
    expect(rules("src/server/social/zernio-adapter.ts", "export const ZERNIO_LIVE_NETWORK = process.env.X === '1';")).toEqual(expect.arrayContaining(["ZERNIO_LIVE_NETWORK must be the literal constant false", "environment read inside the social layer (kill switches are constants)"]));
    expect(rules("src/server/social/registry.ts", "export const SOCIAL_INTEGRATION_ENABLED = true;")).toContain("SOCIAL_INTEGRATION_ENABLED must be the literal constant false");
    expect(rules("src/server/social/registry.ts", "export const SOCIAL_INTEGRATION_ENABLED = false; new X({ fetch });")).toContain("the registry must not inject a fetch");
    expect(rules("src/server/social/service.ts", "await fetch('https://x.test')")).toContain("network call inside the social layer outside the adapter");
  });
  it("keeps sending entry points inside the port and adapters", () => {
    expect(rules("src/server/social/service.ts", "await provider.sendMessage(c, r)")).toContain("sending entry point outside the port and adapters");
    expect(rules("src/server/crm.ts", "x.replyToComment(a)")).toContain("sending entry point outside the port and adapters");
    expect(rules("src/server/crm.ts", "getSocialSender()")).toContain("sender accessor used outside the registry");
    expect(rules("src/server/social/fake-provider.ts", "async sendMessage(a, b) {}")).toEqual([]);
  });
});
