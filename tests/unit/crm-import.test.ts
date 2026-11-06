import { describe, expect, it } from "vitest";
import { csvCell, csvLine, detectDelimiter, formulaSafe, parseCsv, parseCsvRecords, stripFormulaGuard } from "../../src/lib/csv";
import { companyReference, mappingSchema, parseCompanyRow, parsePersonRow, suggestMapping } from "../../src/lib/crm-import";
import { can } from "../../src/server/permissions";

describe("CSV reading", () => {
  it("reads quotes, escaped quotes, line breaks inside cells, CRLF, a BOM and blank lines", () => {
    expect(parseCsvRecords("﻿Name,Notes\r\n\"Doe, Jane\",\"said \"\"hi\"\"\nthen left\"\r\n\r\nBob,\n")).toEqual([["Name", "Notes"], ["Doe, Jane", "said \"hi\"\nthen left"], ["Bob", ""]]);
    expect(parseCsvRecords("a,\"b")).toBe("unterminated_quote");
  });
  it("detects semicolon and tab files from the header line", () => {
    expect(detectDelimiter("Name;Email\nA;b")).toBe(";");
    expect(detectDelimiter("Name\tEmail")).toBe("\t");
    expect(detectDelimiter("\"A;B\",C")).toBe(",");
    expect(parseCsv("Name;Email\nAda;ada@example.test")).toEqual({ ok: true, headers: ["Name", "Email"], rows: [["Ada", "ada@example.test"]] });
  });
  it("pads short rows, names empty headers and enforces the limits", () => {
    expect(parseCsv("Name,,Phone\nAda")).toEqual({ ok: true, headers: ["Name", "Column 2", "Phone"], rows: [["Ada", "", ""]] });
    expect(parseCsv("Name\n")).toEqual({ ok: false, error: "empty" });
    expect(parseCsv("Name,name\nA,B")).toEqual({ ok: false, error: "duplicate_headers" });
    expect(parseCsv(`${Array.from({ length: 101 }, (_, index) => `c${index}`).join(",")}\n1`)).toEqual({ ok: false, error: "too_many_columns" });
    expect(parseCsv(`Name\n${"x".repeat(5001)}`)).toEqual({ ok: false, error: "cell_too_long" });
  });
});

describe("CSV writing is formula-safe", () => {
  it("prefixes cells starting with =, +, -, @, tab or CR and quotes delimiters", () => {
    for (const risky of ["=SUM(A1)", "+4915112345678", "-2+3", "@cmd", "\tx", "\rx"]) expect(formulaSafe(risky)).toBe(`'${risky}`);
    expect(formulaSafe("Ada")).toBe("Ada");
    expect(csvCell("=HYPERLINK(\"http://x\",\"y\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"");
    expect(csvLine(["a,b", 3, null, true])).toBe("\"a,b\",3,,true\r\n");
  });
  it("round-trips: import strips only the guard Harvest's export added", () => {
    expect(stripFormulaGuard("'=SUM(A1)")).toBe("=SUM(A1)");
    expect(stripFormulaGuard("'tis the season")).toBe("'tis the season");
    expect(parseCsvRecords(csvLine(["=1+1", "plain"]))).toEqual([["'=1+1", "plain"]]);
  });
});

describe("mapping", () => {
  it("suggests targets only from a fixed synonym list, each once, deterministically", () => {
    expect(suggestMapping("person", ["Full Name", "E-mail Address", "Mobile", "Email", "Job Title", "Church", "Favourite colour"]))
      .toEqual(["name", "email", "phone", null, "title", "company", null]);
    expect(suggestMapping("company", ["Organisation", "Website", "About"])).toEqual(["name", "domain", "description"]);
  });
  it("requires Name, forbids repeats and unknown targets, and needs Company for a job title", () => {
    const schema = mappingSchema("person", 3);
    expect(schema.safeParse(["name", "email", null]).success).toBe(true);
    expect(schema.safeParse([null, "email", null]).success).toBe(false);
    expect(schema.safeParse(["name", "name", null]).success).toBe(false);
    expect(schema.safeParse(["name", "domain", null]).success).toBe(false);
    expect(schema.safeParse(["name", "title", null]).success).toBe(false);
    expect(schema.safeParse(["name", null]).success).toBe(false);
  });
});

describe("row validation and identity keys", () => {
  const mapping = ["name", "email", "phone", "social", "company"];
  it("normalizes identifiers into tenant-unique keys and never keys on the name", () => {
    expect(parsePersonRow(["  Ada   Lovelace ", "ADA@Example.test", "+49 (151) 123-45678", "@Ada_L", "grace.example"], mapping)).toEqual({
      ok: true, keys: ["email:ada@example.test", "phone:+4915112345678", "social:ada_l"],
      value: { name: "Ada Lovelace", normalizedName: "ada lovelace", email: "ada@example.test", phone: "+4915112345678", social: "@Ada_L", notes: "", company: "grace.example", title: "" },
    });
    expect(parsePersonRow(["Ada", "", "", "", ""], mapping)).toMatchObject({ ok: true, keys: [] });
  });
  it("reports the first problem with a stable code", () => {
    expect(parsePersonRow(["", "a@example.test", "", "", ""], mapping)).toMatchObject({ ok: false, error: "missing_name", keys: ["email:a@example.test"] });
    expect(parsePersonRow(["Ada", "nope", "", "", ""], mapping)).toMatchObject({ ok: false, error: "invalid_email" });
    expect(parsePersonRow(["Ada", "", "0151", "", ""], mapping)).toMatchObject({ ok: false, error: "invalid_phone" });
    expect(parsePersonRow(["Ada", "", "", "bad handle", ""], mapping)).toMatchObject({ ok: false, error: "invalid_social" });
    expect(parsePersonRow(["x".repeat(101), "", "", "", ""], mapping)).toMatchObject({ ok: false, error: "name_too_long" });
  });
  it("matches companies by normalized domain only", () => {
    expect(parseCompanyRow(["Grace", "https://WWW.Grace.example/about", ""], ["name", "domain", "description"])).toMatchObject({ ok: true, keys: ["domain:grace.example"] });
    expect(parseCompanyRow(["Grace", "mailto:x@y.z", ""], ["name", "domain", "description"])).toMatchObject({ ok: false, error: "invalid_domain" });
    expect(companyReference("grace.example")).toEqual({ domain: "grace.example" });
    expect(companyReference("Grace  Chapel")).toEqual({ name: "grace chapel" });
  });
});

describe("permissions", () => {
  it("lets writers import and export, and only owners and admins merge or export notes", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => [can(role, "crm:import"), can(role, "crm:export"), can(role, "contacts:merge"), can(role, "crm:export_sensitive")])).toEqual([
      [true, true, true, true], [true, true, true, true], [true, true, false, false], [false, false, false, false],
    ]);
  });
});
