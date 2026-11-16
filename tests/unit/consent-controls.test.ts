import { describe, expect, it } from "vitest";
import { consentControls } from "@/lib/consent-controls";

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
