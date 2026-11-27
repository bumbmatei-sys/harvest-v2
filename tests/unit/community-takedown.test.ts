import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import messages from "../../messages/en.json";
import { communityHarvestReportSchema, contentHarvestReportSchema, harvestReportReasons, takedownSchema } from "../../src/lib/community-takedown";

// Harvest staff takedown for communities, posts and replies (0137): input rules and the copy every reason needs.
const id = "3f0b6c52-7f6e-4d43-9d1c-1f3c1a2b3c4d";
it("validates visitor and member reports", () => {
  expect(communityHarvestReportSchema.parse({ reason: "scam", note: "  x  " })).toEqual({ reason: "scam", note: "x" });
  expect(communityHarvestReportSchema.parse({ reason: "spam", note: "   " }).note).toBeNull();
  for (const bad of [{ reason: "nope" }, { reason: "spam", note: "x".repeat(501) }, { reason: "spam", note: "a\u0000b" }, { reason: "spam", extra: 1 }])
    expect(communityHarvestReportSchema.safeParse(bad).success).toBe(false);
  expect(contentHarvestReportSchema.safeParse({ targetType: "post", targetId: id, reason: "harassment" }).success).toBe(true);
  expect(contentHarvestReportSchema.safeParse({ targetType: "community", targetId: id, reason: "spam" }).success).toBe(false);
  expect(contentHarvestReportSchema.safeParse({ targetType: "post", targetId: "x", reason: "spam" }).success).toBe(false);
});

it("needs a reason to hide but not to restore", () => {
  expect(takedownSchema.safeParse({ targetType: "post", targetId: id, hidden: true }).success).toBe(false);
  expect(takedownSchema.safeParse({ targetType: "post", targetId: id, hidden: true, reason: "Spam" }).success).toBe(true);
  expect(takedownSchema.safeParse({ targetType: "community", targetId: id, hidden: false }).success).toBe(true);
  expect(takedownSchema.safeParse({ targetType: "member", targetId: id, hidden: false }).success).toBe(false);
});

it("keeps the reasons identical in the code, the database check and the copy", () => {
  const sql = readFileSync("drizzle/0137_community_takedown.sql", "utf8");
  const check = sql.match(/"community_harvest_reports_reason" CHECK \([^)]*in \(([^)]*)\)/)![1].split(",").map((s) => s.trim().replace(/'/g, ""));
  expect(check).toEqual([...harvestReportReasons]);
  expect(Object.keys(messages.CommunityTakedown.report.reasons)).toEqual([...harvestReportReasons]);
  expect(sql).toContain("'spam','harassment','inappropriate','impersonation','scam','other'");
});
