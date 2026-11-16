import { describe, expect, it } from "vitest";
import { MINISTRY_SEARCH_THRESHOLD, filterMinistries, ministryInitials, shouldShowMinistrySearch } from "../../src/lib/ministry-switcher";

describe("ministry switcher helpers", () => {
  it("shows search only above five ministries", () => {
    expect(MINISTRY_SEARCH_THRESHOLD).toBe(5);
    expect([0, 1, 5].map(shouldShowMinistrySearch)).toEqual([false, false, false]);
    expect([6, 12].map(shouldShowMinistrySearch)).toEqual([true, true]);
  });
  it("builds up to two initials and never an empty mark", () => {
    expect(ministryInitials("Grace Church")).toBe("GC");
    expect(ministryInitials("hope")).toBe("HO");
    expect(ministryInitials("  Saint  John's  Parish ")).toBe("SJ");
    expect(ministryInitials("Émile Ministries")).toBe("ÉM");
    expect(ministryInitials("— ✝ —")).toBe("M");
  });
  it("filters by name, ignoring case and surrounding space, and keeps order", () => {
    const list = [{ name: "Grace Church" }, { name: "Hope Outreach" }, { name: "Church Plant" }];
    expect(filterMinistries(list, " CHURCH ").map((item) => item.name)).toEqual(["Grace Church", "Church Plant"]);
    expect(filterMinistries(list, "")).toEqual(list);
    expect(filterMinistries(list, "nothing")).toEqual([]);
  });
});
