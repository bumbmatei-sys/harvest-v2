import { describe, expect, it } from "vitest";
import { continueLesson, noteLimit, percentComplete, validNote } from "../../src/lib/course-progress";

const lessons = ["a", "b", "c", "d"].map((id) => ({ id }));
describe("course progress rules", () => {
  it("gives a whole-number percentage of published lessons, never above 100", () => {
    expect(percentComplete(0, 3)).toBe(0);
    expect(percentComplete(1, 3)).toBe(33);
    expect(percentComplete(2, 3)).toBe(67);
    expect(percentComplete(3, 3)).toBe(100);
    expect(percentComplete(5, 3)).toBe(100);
    expect(percentComplete(1, 0)).toBe(0);
  });
  it("continues after the last completed lesson, else at the first open one, else at the end", () => {
    expect(continueLesson(lessons, [])).toBe("a");
    expect(continueLesson(lessons, ["a"])).toBe("b");
    expect(continueLesson(lessons, ["a", "c"])).toBe("d");
    expect(continueLesson(lessons, ["d"])).toBe("a");
    expect(continueLesson(lessons, ["a", "b", "c", "d"])).toBe("d");
    expect(continueLesson(lessons, ["gone"])).toBe("a");
    expect(continueLesson([], [])).toBeNull();
  });
  it("accepts plain-text notes up to the limit, with line breaks and tabs, and nothing else", () => {
    for (const note of ["", "Pray daily.", "Line one\nLine two\tTabbed\r\n", "x".repeat(noteLimit), "Молитва 🙏"]) expect(validNote(note), note).toBe(true);
    for (const note of ["x".repeat(noteLimit + 1), "bell\u0007", "nul\u0000", "esc\u001b[31m", "del\u007f"]) expect(validNote(note), JSON.stringify(note)).toBe(false);
  });
});
