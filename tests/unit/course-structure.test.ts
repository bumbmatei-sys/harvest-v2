import { describe, expect, it } from "vitest";
import {
  addLesson, addLevel, addSection, canMoveLesson, canMoveSection, canRemoveSection, labelOr, moveLesson, moveLevel, moveSection, removeLevel, removeSection,
  showsStructure, validLabel, type Structure,
} from "../../src/lib/course-structure";

type L = { key: string; section: string };
const lessons = (pairs: string) => pairs.split(" ").map((pair) => { const [key, section] = pair.split(":"); return { key, section }; });
const base = (): Structure<L> => ({ levels: [], sections: [{ key: "s1", title: "", level: null }, { key: "s2", title: "", level: null }], lessons: lessons("a:s1 b:s1 c:s2") });
const order = (value: Structure<L>) => value.lessons.map((row) => `${row.key}:${row.section}`).join(" ");

describe("course labels", () => {
  it("accepts an empty label (the default) and up to 24 characters, never control characters", () => {
    for (const label of ["", "  ", "Week", "Module", "Неделя", "x".repeat(24), ` ${"x".repeat(24)} `]) expect(validLabel(label), label).toBe(true);
    for (const label of ["x".repeat(25), "Week\u0000", "Wee\nk", "\u007f"]) expect(validLabel(label), JSON.stringify(label)).toBe(false);
    expect(labelOr(" Week ", "Section")).toBe("Week");
    expect(labelOr(null, "Section")).toBe("Section");
    expect(labelOr("  ", "Section")).toBe("Section");
  });
});

describe("course structure moves", () => {
  it("moves a lesson within its section and across section edges", () => {
    const value = base();
    expect(order(moveLesson(value, "b", -1))).toBe("b:s1 a:s1 c:s2");
    expect(order(moveLesson(value, "b", 1))).toBe("a:s1 b:s2 c:s2");
    expect(order(moveLesson(value, "c", -1))).toBe("a:s1 b:s1 c:s1");
    expect(canMoveLesson(value, "a", -1)).toBe(false);
    expect(canMoveLesson(value, "c", 1)).toBe(false);
    expect(moveLesson(value, "a", -1)).toBe(value);
    // Into an empty section and back out.
    const gap: Structure<L> = { ...value, sections: [...value.sections, { key: "s3", title: "", level: null }] };
    expect(order(moveLesson(gap, "c", 1))).toBe("a:s1 b:s1 c:s3");
    expect(order(moveLesson(moveLesson(gap, "c", 1), "c", -1))).toBe("a:s1 b:s1 c:s2");
  });
  it("keeps sections within levels, moves them across level edges, and orders lessons with them", () => {
    let value = addLevel(base(), { key: "v1", title: "" });
    expect(value.sections.every((row) => row.level === "v1")).toBe(true);
    value = addLevel(value, { key: "v2", title: "" });
    expect(canMoveSection(value, "s2", 1)).toBe(true);
    value = moveSection(value, "s2", 1);
    expect(value.sections.map((row) => `${row.key}:${row.level}`)).toEqual(["s1:v1", "s2:v2"]);
    value = moveLevel(value, "v2", -1);
    expect(value.levels.map((row) => row.key)).toEqual(["v2", "v1"]);
    expect(value.sections.map((row) => row.key)).toEqual(["s2", "s1"]);
    expect(order(value)).toBe("c:s2 a:s1 b:s1");
    expect(canMoveSection(base(), "s1", -1)).toBe(false);
    expect(order(moveSection(base(), "s1", 1))).toBe("c:s2 a:s1 b:s1");
  });
  it("adds and removes parts without losing lessons", () => {
    const value = base();
    expect(order(addLesson(value, { key: "d", section: "" }, "s1"))).toBe("a:s1 b:s1 d:s1 c:s2");
    expect(order(addLesson(value, { key: "d", section: "" }))).toBe("a:s1 b:s1 c:s2 d:s2");
    const fresh = addLesson({ levels: [], sections: [], lessons: [] }, { key: "d", section: "" });
    expect(fresh.sections).toHaveLength(1);
    expect(fresh.lessons[0].section).toBe(fresh.sections[0].key);
    expect(showsStructure(fresh)).toBe(false);
    expect(order(removeSection(value, "s2"))).toBe("a:s1 b:s1 c:s1");
    expect(order(removeSection(value, "s1"))).toBe("a:s2 b:s2 c:s2");
    const single: Structure<L> = { levels: [], sections: [{ key: "s1", title: "", level: null }], lessons: lessons("a:s1") };
    expect(canRemoveSection(single, "s1")).toBe(false);
    expect(removeSection(single, "s1")).toBe(single);
    let levelled = addLevel(addLevel(value, { key: "v1", title: "" }), { key: "v2", title: "" });
    levelled = addSection(levelled, { key: "s3", title: "", level: null });
    expect(levelled.sections.find((row) => row.key === "s3")?.level).toBe("v2");
    expect(removeLevel(levelled, "v2").sections.every((row) => row.level === "v1")).toBe(true);
    const flat = removeLevel(removeLevel(levelled, "v2"), "v1");
    expect(flat.levels).toEqual([]);
    expect(flat.sections.every((row) => row.level === null)).toBe(true);
    expect(order(flat)).toBe(order(levelled));
    expect(showsStructure(value)).toBe(true);
  });
});
