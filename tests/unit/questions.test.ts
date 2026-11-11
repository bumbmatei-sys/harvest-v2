import { describe, expect, it } from "vitest";
import { newQuestionId, questionSet, validateAnswers, type Question } from "../../src/lib/questions";

const q = (over: Partial<Question> & Pick<Question, "id" | "type">): Question => ({ label: "Question", required: false, ...over });
const set: Question[] = [
  q({ id: "aaaaaaaa", type: "short", label: "Your city", required: true }),
  q({ id: "bbbbbbbb", type: "paragraph", label: "Why join?" }),
  q({ id: "cccccccc", type: "choice", label: "Church member?", required: true, options: ["Yes", "No"] }),
  q({ id: "dddddddd", type: "checkboxes", label: "Interests", options: ["Prayer", "Study", "Service"] }),
];

describe("questionSet", () => {
  it("accepts a valid set", () => { expect(questionSet.parse(set)).toEqual(set); });
  it("rejects more than ten questions", () => {
    expect(questionSet.safeParse(Array.from({ length: 11 }, (_, i) => q({ id: `q000000${i}`.slice(-8).replace(/^/, "") as string, type: "short" }))).success).toBe(false);
  });
  it("needs 2–20 options for choice types and none for text types", () => {
    expect(questionSet.safeParse([q({ id: "aaaaaaaa", type: "choice", options: ["Only"] })]).success).toBe(false);
    expect(questionSet.safeParse([q({ id: "aaaaaaaa", type: "checkboxes" })]).success).toBe(false);
    expect(questionSet.safeParse([q({ id: "aaaaaaaa", type: "short", options: ["A", "B"] })]).success).toBe(false);
    expect(questionSet.safeParse([q({ id: "aaaaaaaa", type: "choice", options: ["A", "A"] })]).success).toBe(false);
  });
  it("rejects duplicate or malformed ids and empty labels", () => {
    expect(questionSet.safeParse([q({ id: "aaaaaaaa", type: "short" }), q({ id: "aaaaaaaa", type: "short" })]).success).toBe(false);
    expect(questionSet.safeParse([q({ id: "BAD", type: "short" })]).success).toBe(false);
    expect(questionSet.safeParse([q({ id: "aaaaaaaa", type: "short", label: "  " })]).success).toBe(false);
  });
  it("makes valid ids", () => { expect(newQuestionId()).toMatch(/^[a-z0-9]{8}$/); });
});

describe("validateAnswers", () => {
  it("accepts complete answers, trims them and drops unknown and empty ones", () => {
    expect(validateAnswers(set, { aaaaaaaa: "  Cluj ", cccccccc: "Yes", dddddddd: ["Study", "Prayer"], bbbbbbbb: "  ", zzzzzzzz: "x" }))
      .toEqual({ ok: true, answers: { aaaaaaaa: "Cluj", cccccccc: "Yes", dddddddd: ["Study", "Prayer"] } });
  });
  it("refuses a missing required answer", () => { expect(validateAnswers(set, { cccccccc: "Yes" })).toEqual({ ok: false, questionId: "aaaaaaaa" }); });
  it("refuses an option that is not offered", () => {
    expect(validateAnswers(set, { aaaaaaaa: "x", cccccccc: "Maybe" })).toEqual({ ok: false, questionId: "cccccccc" });
    expect(validateAnswers(set, { aaaaaaaa: "x", cccccccc: "Yes", dddddddd: ["Study", "Golf"] })).toEqual({ ok: false, questionId: "dddddddd" });
  });
  it("refuses the wrong shape and too-long text", () => {
    expect(validateAnswers(set, { aaaaaaaa: ["x"], cccccccc: "Yes" })).toEqual({ ok: false, questionId: "aaaaaaaa" });
    expect(validateAnswers(set, { aaaaaaaa: "x".repeat(201), cccccccc: "Yes" })).toEqual({ ok: false, questionId: "aaaaaaaa" });
    expect(validateAnswers(set, { aaaaaaaa: "x", cccccccc: "Yes", bbbbbbbb: "x".repeat(2001) })).toEqual({ ok: false, questionId: "bbbbbbbb" });
    expect(validateAnswers(set, { aaaaaaaa: "x", cccccccc: "Yes", dddddddd: ["Study", "Study"] })).toEqual({ ok: false, questionId: "dddddddd" });
  });
  it("accepts no answers when nothing is asked", () => { expect(validateAnswers([], {})).toEqual({ ok: true, answers: {} }); });
});
