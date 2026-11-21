import { describe, expect, it } from "vitest";
import { message } from "../../src/i18n/messages";
import { CONSENT_ID, buildForm, commit, formDefinitionSchema, formIssues, insertBlock, menuGroups, moveBlock, newBlock, normalizeBlock, pagedSteps, recall, redo, removeBlock, startHistory, templateIds, undo, validateBlock, validateForm, type FormBlock, type FormDefinition, type FormText } from "../../src/lib/crm-forms";
import { emptyPrefs, parsePrefs, recents, toggleFavorite, touchViewed } from "../../src/lib/form-prefs";

const text: FormText = (key, values) => message(`CrmForms.${key}` as Parameters<typeof message>[0], values);
const people = { type: "people" as const };
const scratch = () => buildForm(null, people, text, "2026-11-21T00:00:00.000Z");
const q = (patch: Partial<FormBlock> & { id: string }): FormBlock => ({ type: "short", label: "Q", required: false, mapTo: null, ...patch });

describe("form definition", () => {
  it("builds every template into a valid definition with the mandatory consent block last", () => {
    for (const id of templateIds) {
      const form = buildForm(id, people, text, "2026-11-21T00:00:00.000Z");
      expect(formDefinitionSchema.safeParse(form).success, id).toBe(true);
      expect(form.blocks[form.blocks.length - 1]).toMatchObject({ id: CONSENT_ID, type: "consent", required: true });
      expect(form.blocks.some((b) => b.mapTo === "name") || id === "feedback").toBe(true);
    }
    expect(formDefinitionSchema.safeParse(scratch()).success).toBe(true);
  });
  it("keeps the {name} recall token in the thank-you title instead of failing on it", () => {
    expect(scratch().endTitle).toBe("Thank you, {name}");
  });
  it("refuses a form without the consent block, with it moved, or optional", () => {
    const form = scratch();
    expect(formDefinitionSchema.safeParse({ ...form, blocks: [] }).success).toBe(false);
    expect(formDefinitionSchema.safeParse({ ...form, blocks: [form.blocks[0], q({ id: "aaaaaaaa" })] }).success).toBe(false);
    expect(formDefinitionSchema.safeParse({ ...form, blocks: [{ ...form.blocks[0], required: false }] }).success).toBe(false);
  });
  it("checks options, CRM mappings and duplicates", () => {
    const base = scratch(), ok = (blocks: FormBlock[]) => formDefinitionSchema.safeParse({ ...base, blocks: [...blocks, base.blocks[base.blocks.length - 1]] }).success;
    expect(ok([q({ id: "aaaaaaaa", type: "email", mapTo: "email" })])).toBe(true);
    expect(ok([q({ id: "aaaaaaaa", type: "short", mapTo: "email" })])).toBe(false);
    expect(ok([q({ id: "aaaaaaaa", mapTo: "name" }), q({ id: "bbbbbbbb", mapTo: "name" })])).toBe(false);
    expect(ok([q({ id: "aaaaaaaa", type: "dropdown" })])).toBe(false);
    expect(ok([q({ id: "aaaaaaaa", type: "dropdown", options: ["A", "B"] })])).toBe(true);
    expect(ok([q({ id: "aaaaaaaa", type: "dropdown", options: ["A", "A"] })])).toBe(false);
    expect(ok([q({ id: "aaaaaaaa", type: "short", options: ["A", "B"] })])).toBe(false);
    expect(ok([q({ id: "aaaaaaaa" }), q({ id: "aaaaaaaa" })])).toBe(false);
  });
  it("accepts only https for the redirect and logo", () => {
    const base = scratch();
    expect(formDefinitionSchema.safeParse({ ...base, logoUrl: "http://x.test/a.png" }).success).toBe(false);
    expect(formDefinitionSchema.safeParse({ ...base, logoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(formDefinitionSchema.safeParse({ ...base, settings: { ...base.settings, redirectUrl: "https://example.org/thanks" } }).success).toBe(true);
    expect(formDefinitionSchema.safeParse({ ...base, settings: { ...base.settings, redirectUrl: "http://example.org" } }).success).toBe(false);
  });
  it("reports what stops a form from being ready", () => {
    expect(formIssues(scratch())).toEqual(["noName", "noContact"]);
    expect(formIssues({ ...scratch(), destination: null })).toContain("noDestination");
    expect(formIssues(buildForm("visitor", people, text, "x"))).toEqual([]);
  });
});

describe("blocks", () => {
  const form = scratch();
  const a = q({ id: "aaaaaaaa" }), b = q({ id: "bbbbbbbb" }), c = q({ id: "cccccccc" }), consent = form.blocks[form.blocks.length - 1];
  it("reorders and keeps the consent block last, whatever is asked", () => {
    expect(moveBlock([a, b, c, consent], 0, 2).map((x) => x.id)).toEqual(["bbbbbbbb", "cccccccc", "aaaaaaaa", CONSENT_ID]);
    expect(moveBlock([a, b, c, consent], 2, 0).map((x) => x.id)).toEqual(["cccccccc", "aaaaaaaa", "bbbbbbbb", CONSENT_ID]);
    expect(moveBlock([a, b, c, consent], 3, 0)).toEqual([a, b, c, consent]);
    expect(moveBlock([a, b, c, consent], 0, 3)).toEqual([a, b, c, consent]);
    expect(moveBlock([a, b, c, consent], 1, 1)).toEqual([a, b, c, consent]);
  });
  it("inserts before the consent block and never removes it", () => {
    expect(insertBlock([a, consent], b).map((x) => x.id)).toEqual(["aaaaaaaa", "bbbbbbbb", CONSENT_ID]);
    expect(removeBlock([a, consent], "aaaaaaaa")).toEqual([consent]);
    expect(removeBlock([a, consent], CONSENT_ID)).toEqual([a, consent]);
  });
  it("creates blocks from every menu item, valid in a form", () => {
    for (const group of menuGroups) for (const item of group.items) {
      const block = newBlock(item, "Label", ["One", "Two"]);
      expect(formDefinitionSchema.safeParse({ ...form, blocks: [block, consent] }).success, item.id).toBe(true);
    }
  });
  it("adds or drops options and clears a mapping when the type changes", () => {
    const changed = normalizeBlock({ ...q({ id: "aaaaaaaa", mapTo: "name" }), type: "dropdown" }, ["One", "Two"]);
    expect(changed).toMatchObject({ options: ["One", "Two"], mapTo: null });
    expect("options" in normalizeBlock({ ...changed, type: "short" }, ["One", "Two"])).toBe(false);
  });
});

describe("answers", () => {
  const email = q({ id: "eeeeeeee", type: "email", required: true });
  it("validates by block type", () => {
    expect(validateBlock(email, "")).toBe("required");
    expect(validateBlock(email, "nope")).toBe("email");
    expect(validateBlock(email, "a@b.org")).toBeNull();
    expect(validateBlock(q({ id: "pppppppp", type: "phone" }), "")).toBeNull();
    expect(validateBlock(q({ id: "pppppppp", type: "phone" }), "abc")).toBe("phone");
    expect(validateBlock(q({ id: "nnnnnnnn", type: "number" }), "1.5")).toBeNull();
    expect(validateBlock(q({ id: "nnnnnnnn", type: "number" }), "x")).toBe("number");
    expect(validateBlock(q({ id: "wwwwwwww", type: "website" }), "example.org")).toBeNull();
    expect(validateBlock(q({ id: "mmmmmmmm", type: "multi", required: true, options: ["A", "B"] }), [])).toBe("required");
    expect(validateBlock(q({ id: "iiiiiiii", type: "info" }), undefined)).toBeNull();
  });
  it("requires consent to submit", () => {
    const form = scratch();
    expect(validateForm(form, {})[CONSENT_ID]).toBe("consent");
    expect(validateForm(form, { [CONSENT_ID]: "yes" })[CONSENT_ID]).toBeUndefined();
  });
  it("recalls the name in titles and messages", () => {
    const form: FormDefinition = { ...scratch(), blocks: [q({ id: "nameblck", mapTo: "name" }), scratch().blocks[0]] };
    expect(recall("Thank you, {name}", form, { nameblck: " Grace " })).toBe("Thank you, Grace");
    expect(recall("Thank you, {name}", form, {})).toBe("Thank you");
    expect(recall("Hi {name}. Welcome, {name}!", form, { nameblck: "Sam" })).toBe("Hi Sam. Welcome, Sam!");
  });
  it("groups one-per-page steps, attaching information to the next question", () => {
    const info = q({ id: "iiiiiiii", type: "info" }), steps = pagedSteps([info, a(), b2(), scratch().blocks[0]]);
    expect(steps.map((s) => s.map((x) => x.id))).toEqual([["iiiiiiii", "aaaaaaaa"], ["bbbbbbbb"], [CONSENT_ID]]);
    function a() { return q({ id: "aaaaaaaa" }); }
    function b2() { return q({ id: "bbbbbbbb" }); }
  });
});

describe("undo history", () => {
  it("undoes and redoes, and a new edit drops the redo branch", () => {
    let h = startHistory(1);
    h = commit(h, 2, 0); h = commit(h, 3, 0);
    expect(undo(h).present).toBe(2); expect(undo(undo(h)).present).toBe(1); expect(undo(undo(undo(h))).present).toBe(1);
    expect(redo(undo(h)).present).toBe(3);
    expect(commit(undo(h), 9, 0).future).toEqual([]);
  });
  it("merges a typing burst with the same key into one step", () => {
    let h = startHistory("");
    for (const [i, value] of ["a", "ab", "abc"].entries()) h = commit(h, value, i * 100, "title");
    expect(h.past).toEqual([""]);
    h = commit(h, "abcd", 5000, "title");
    expect(h.past).toEqual(["", "abc"]);
    expect(commit(h, "abcd", 6000, "title")).toBe(h);
  });
});

describe("list preferences (this browser only)", () => {
  it("toggles favorites, orders recents and survives bad storage", () => {
    let p = toggleFavorite(emptyPrefs, "a"); expect(p.favorites).toEqual(["a"]); expect(toggleFavorite(p, "a").favorites).toEqual([]);
    p = touchViewed(touchViewed(p, "a", 10), "b", 20); expect(recents(p)).toEqual(["b", "a"]);
    expect(parsePrefs("not json")).toEqual(emptyPrefs); expect(parsePrefs(null)).toEqual(emptyPrefs);
    expect(parsePrefs(JSON.stringify({ favorites: ["x", 3], viewed: { y: 1, z: "no" } }))).toEqual({ favorites: ["x"], viewed: { y: 1 } });
  });
});
