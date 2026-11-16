import { expect, it } from "vitest";
import { inspectSocialBoundary, checkSocialBoundary, inspectProviderCopy } from "../../scripts/source-guards";
it("office boundary and all hard disables are guarded", () => {
  expect(checkSocialBoundary()).toEqual([]);
  for (const folder of ["mail","calendar","files-provider"]) {
    expect(inspectSocialBoundary(`src/server/${folder}/registry.ts`, "export const INTEGRATION_ENABLED = true;")).not.toEqual([]);
    expect(inspectSocialBoundary(`src/server/${folder}/zernio-adapter.ts`, "export const ZERNIO_LIVE_NETWORK = true;")).not.toEqual([]);
    expect(inspectSocialBoundary(`src/server/${folder}/fake-provider.ts`, "fetch('https://example.test');")).not.toEqual([]);
    expect(inspectSocialBoundary(`src/server/${folder}/port.ts`, 'import SDK from "@zernio/node"')).not.toEqual([]);
  }
});

it("vendor copy guard examines values, including nested values, but permits internal keys", () => { expect(inspectProviderCopy({ zernio: "Connected channel" })).toEqual([]); expect(inspectProviderCopy({ nested: { label: "Connect Gmail" } })).toHaveLength(1); });
