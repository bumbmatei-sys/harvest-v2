import { expect, it } from "vitest";
import { stagingEmailEnabled, submitStagingEmail } from "../../src/server/staging-email-transport";

it("requires the explicit staging deployment and opt-in and blocks a production marker", async () => {
  const staging = { HARVEST_ENV: "staging", EMAIL_LIVE_STAGING: "1" };
  expect(stagingEmailEnabled(staging)).toBe(true);
  expect(stagingEmailEnabled({ ...staging, HARVEST_ENV: "production" })).toBe(false);
  expect(stagingEmailEnabled({ ...staging, VERCEL_ENV: "production" })).toBe(false);
  expect(stagingEmailEnabled({ ...staging, EMAIL_LIVE_STAGING: "0" })).toBe(false);
  await expect(submitStagingEmail(staging, {
    to: "reader@example.invalid", deliveryId: "test", headers: {}, text: "Test", subject: "Test",
  }, () => { throw new Error("network must remain unused"); })).rejects.toThrow("STAGING_EMAIL_REFUSED");
});
