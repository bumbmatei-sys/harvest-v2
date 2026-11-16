import { describe, expect, it } from "vitest";
import { consentControls, rowActions } from "@/lib/consent-controls";

describe("consentControls", () => {
  it.each(["owner", "admin"])("%s may grant and withdraw", (role) => {
    expect(consentControls(role)).toEqual({ canGrant: true, canWithdraw: true, statuses: ["unknown", "granted", "withdrawn"], canRecord: true });
  });
  it("member may only withdraw", () => {
    expect(consentControls("member")).toEqual({ canGrant: false, canWithdraw: true, statuses: ["withdrawn"], canRecord: true });
  });
  it.each(["viewer", "stranger", ""])("%s records nothing", (role) => {
    expect(consentControls(role)).toEqual({ canGrant: false, canWithdraw: false, statuses: [], canRecord: false });
  });
});

describe("rowActions", () => {
  const owner = consentControls("owner"), member = consentControls("member"), viewer = consentControls("viewer");
  it("offers both choices on a purpose with nothing recorded, by permission", () => {
    expect(rowActions("none", owner)).toEqual(["granted", "withdrawn"]);
    expect(rowActions("none", member)).toEqual(["withdrawn"]);
    expect(rowActions("none", viewer)).toEqual([]);
  });
  it("leaves granted and withdrawn rows unchanged", () => {
    expect(rowActions("granted", owner)).toEqual(["withdrawn"]);
    expect(rowActions("granted", member)).toEqual(["withdrawn"]);
    expect(rowActions("withdrawn", owner)).toEqual(["granted"]);
    expect(rowActions("withdrawn", member)).toEqual([]);
    expect(rowActions("granted", viewer)).toEqual([]);
  });
});
