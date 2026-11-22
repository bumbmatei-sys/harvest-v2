import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRM_NOTIFICATION_EMAIL_ENABLED, CRM_NOTIFICATION_PUSH_ENABLED } from "../../src/lib/crm-notification-channels";

describe("CRM notification channels stay hard-off", () => {
  it("keeps email and push as literal false", () => {
    expect([CRM_NOTIFICATION_EMAIL_ENABLED, CRM_NOTIFICATION_PUSH_ENABLED]).toEqual([false, false]);
    const source = readFileSync("src/lib/crm-notification-channels.ts", "utf8");
    expect(source).toMatch(/CRM_NOTIFICATION_EMAIL_ENABLED = false;/);
    expect(source).toMatch(/CRM_NOTIFICATION_PUSH_ENABLED = false;/);
  });
  it("does not wire a sender, job or schedule into the task notification code", () => {
    const source = readFileSync("src/server/crm-tasks.ts", "utf8");
    for (const forbidden of [/sendEmail|ses-adapter|web-push|webpush|sendPush/i, /setInterval|cron|enqueue/i]) expect(source).not.toMatch(forbidden);
  });
});
