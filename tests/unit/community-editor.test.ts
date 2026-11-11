import { expect, it } from "vitest";
import { comingSoonSteps, communityEditorSteps, publishChecklist, readyToPublish } from "../../src/lib/community-editor";
import { communitiesEnabled } from "../../src/server/communities-mode";

const base = { name: "Bible study", visibility: "hidden", allowOpen: false, allowApply: false, allowInvite: true, allowEntitlement: false };
it("lists all nine editor steps, four of them not yet available", () => {
  expect(communityEditorSteps).toHaveLength(9);
  expect(comingSoonSteps).toEqual(["channels", "messages", "products", "page"]);
});
it("needs a name, a way in and a visibility before publishing", () => {
  expect(readyToPublish(base)).toBe(true);
  expect(publishChecklist({ ...base, allowInvite: false })).toContainEqual({ key: "admission", done: false });
  expect(readyToPublish({ ...base, name: "  " })).toBe(false);
});
it("keeps Communities off in production unless explicitly enabled", () => {
  expect(communitiesEnabled({ NODE_ENV: "production" })).toBe(false);
  expect(communitiesEnabled({ NODE_ENV: "production", HARVEST_COMMUNITIES: "on" })).toBe(false);
  expect(communitiesEnabled({ NODE_ENV: "production", HARVEST_COMMUNITIES: "enabled" })).toBe(true);
  expect(communitiesEnabled({ NODE_ENV: "development" })).toBe(true);
  expect(communitiesEnabled({ NODE_ENV: "test" })).toBe(true);
});
