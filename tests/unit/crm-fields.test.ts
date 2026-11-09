import { describe, expect, it } from "vitest";
import { columnSpecs, fieldDefinitionInput, filterFields, fullState, operandsByType, paramsToState, parseColumns, parseFilter, recordFieldsPatch, sameState, serializeFilter, slugifyKey, stateToParams, systemViews, validateFilter, valueSchema, viewState } from "../../src/lib/crm-fields";

const definitions = [
  { key: "stage", label: "Stage", type: "select" as const, options: [{ value: "visitor", label: "Visitor" }, { value: "member", label: "Member" }], relationTarget: null, archivedAt: null },
  { key: "gifts", label: "Gifts", type: "number" as const, options: [], relationTarget: null, archivedAt: null },
  { key: "old", label: "Old", type: "text" as const, options: [], relationTarget: null, archivedAt: new Date() },
];

describe("field keys and definitions", () => {
  it("slugifies labels into stable keys", () => {
    expect(slugifyKey("Home church")).toBe("home_church");
    expect(slugifyKey("  Ünïcode & co. ")).toBe("unicode_co");
    expect(slugifyKey("2024 cohort")).toBe("field_2024_cohort");
  });
  it("requires options exactly for choice types and a target exactly for relations", () => {
    expect(fieldDefinitionInput.safeParse({ objectType: "person", label: "A", type: "select", options: [] }).success).toBe(false);
    expect(fieldDefinitionInput.safeParse({ objectType: "person", label: "A", type: "text", options: [{ value: "a", label: "A" }] }).success).toBe(false);
    expect(fieldDefinitionInput.safeParse({ objectType: "person", label: "A", type: "relation" }).success).toBe(false);
    expect(fieldDefinitionInput.safeParse({ objectType: "person", label: "A", type: "relation", relationTarget: "company" }).success).toBe(true);
    expect(fieldDefinitionInput.safeParse({ objectType: "person", label: "A", type: "select", options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }).success).toBe(false);
    expect(fieldDefinitionInput.safeParse({ objectType: "person", label: "A", type: "computed" }).success).toBe(false);
  });
});

describe("value validation per type", () => {
  it.each([
    ["text", "hello", "  "], ["number", 12.5, Number.NaN], ["date", "2024-02-29", "2023-02-29"], ["boolean", false, "false"],
    ["select", "member", "elder"], ["multi_select", ["member"], ["member", "member"]], ["relation", "6f1c2c5e-6a1c-4c35-8a0f-3f5fbc6f2c11", "x"],
  ] as const)("%s accepts %j and rejects %j", (type, good, bad) => {
    const schema = valueSchema({ type, options: definitions[0].options });
    expect(schema.safeParse(good).success).toBe(true);
    expect(schema.safeParse(bad).success).toBe(false);
  });
  it("bounds the patch payload and requires a version", () => {
    expect(recordFieldsPatch.safeParse({ values: { stage: "member" } }).success).toBe(false);
    expect(recordFieldsPatch.safeParse({ values: {}, version: 1 }).success).toBe(false);
    expect(recordFieldsPatch.safeParse({ values: { "Bad Key": 1 }, version: 1 }).success).toBe(false);
  });
});

describe("filter language", () => {
  const fields = filterFields("person", definitions);
  it("round-trips filters through the URL form, including separators in text", () => {
    const filter = { field: "name", op: "contains" as const, value: "a~b,c" };
    expect(parseFilter(serializeFilter(filter))).toEqual(filter);
    expect(parseFilter("cf:stage~any_of~member,visitor")).toEqual({ field: "cf:stage", op: "any_of", value: "member,visitor" });
    for (const bad of ["", "name", "name~", "name~sorta~x", "Name~is~x", "cf:~is~x"]) expect(parseFilter(bad)).toBeNull();
  });
  it("type-checks operands and values against the field, excluding archived fields", () => {
    expect(validateFilter({ field: "cf:stage", op: "any_of", value: "member,visitor" }, fields)?.value).toEqual(["member", "visitor"]);
    expect(validateFilter({ field: "cf:stage", op: "any_of", value: "elder" }, fields)).toBeNull();
    expect(validateFilter({ field: "cf:gifts", op: "gte", value: "1e3" }, fields)).toBeNull();
    expect(validateFilter({ field: "cf:gifts", op: "contains", value: "1" }, fields)).toBeNull();
    expect(validateFilter({ field: "cf:old", op: "is_empty", value: null }, fields)).toBeNull();
    expect(validateFilter({ field: "email", op: "is_empty", value: "x" }, fields)).toBeNull();
    expect(validateFilter({ field: "company", op: "is", value: "not-a-uuid" }, fields)).toBeNull();
    expect(validateFilter({ field: "created", op: "before", value: "2024-01-31" }, fields)).not.toBeNull();
    expect(operandsByType.boolean).toEqual(["is"]);
  });
  it("maps CRM-02 shareable parameters onto the same filters", () => {
    const parsed = paramsToState("person", { company: "none", email: "with", marketing: "granted", sort: "-created", page: "2" });
    expect(parsed?.state.filters).toEqual([{ field: "company", op: "is_empty", value: null }, { field: "email", op: "is_not_empty", value: null }, { field: "marketing", op: "any_of", value: "granted" }]);
    expect(parsed?.page).toBe(2);
    expect(paramsToState("company", { people: "none", domain: "without" })?.state.filters).toEqual([{ field: "people", op: "lte", value: "0" }, { field: "domain", op: "is_empty", value: null }]);
    expect(paramsToState("person", { email: "maybe" })).toBeNull();
    expect(paramsToState("person", { f: "nonsense" })).toBeNull();
    expect(paramsToState("person", { view: "../../etc" })).toBeNull();
  });
});

describe("columns and view state", () => {
  it("parses column lists and exposes only active custom fields as columns", () => {
    expect(parseColumns("email,cf:stage")).toEqual(["email", "cf:stage"]);
    expect(parseColumns("")).toEqual([]);
    expect(parseColumns("email,email")).toBeNull();
    expect(parseColumns(undefined)).toBeNull();
    expect(columnSpecs("person", definitions).map((column) => column.key)).toEqual(["source", "company", "email", "phone", "marketing", "created", "updated", "cf:stage", "cf:gifts"]);
  });
  it("round-trips a full state through URL parameters", () => {
    const state = fullState({ q: "ruth", sort: "-cf:gifts", filters: [{ field: "cf:stage", op: "any_of", value: ["member"] }], columns: ["email", "cf:stage"], density: "compact" });
    const params = stateToParams(state, "system:all-people");
    const back = paramsToState("person", Object.fromEntries([...params.keys()].map((key) => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)!])));
    expect(back?.view).toBe("system:all-people");
    expect(sameState(back!.state, state)).toBe(true);
    expect(viewState.safeParse({ ...state, extra: 1 }).success).toBe(false);
  });
  it("marks an explicitly cleared saved view as URL state", () => {
    const params = stateToParams(fullState({}), "system:email-subscribers");
    expect(params.has("q")).toBe(true);
    expect(params.get("q")).toBe("");
    expect(paramsToState("person", Object.fromEntries(params))?.state.filters).toEqual([]);
    expect(stateToParams(fullState({})).toString()).toBe("");
  });
  it("defines the built-in audience views", () => {
    expect(systemViews.person.map((view) => view.name)).toEqual(["allPeople", "emailSubscribers", "unsubscribed", "noEmailDecision", "noCompany"]);
    expect(systemViews.company.map((view) => view.name)).toEqual(["allCompanies", "withPeople", "noDomain"]);
    for (const view of systemViews.person) for (const filter of fullState(view.state).filters) expect(validateFilter(filter, filterFields("person", []))).not.toBeNull();
    for (const view of systemViews.company) for (const filter of fullState(view.state).filters) expect(validateFilter(filter, filterFields("company", []))).not.toBeNull();
  });
});
