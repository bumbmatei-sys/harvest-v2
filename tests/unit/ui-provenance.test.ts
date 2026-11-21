import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminDashboardHeader, adminDashboardHeaderSource, adminDashboardProvenance, adminDashboardReferences, chatAppHeaderSource, chatAppProvenance, kitChatAppReferences, kitHeaderItem, modelledHeaderSource, kitProvenance, validateKitRecord, type KitItemRecord } from "../../src/lib/ui-provenance";
import { scanForSecrets } from "../../src/lib/secret-scan";

const root = resolve(__dirname, "../..");
const sample: KitItemRecord = { item: "stat-card1", tier: "free", registryRetrieved: "2026-11-17", installed: "2026-11-17", approvedBy: "founder", approvedOn: "2026-11-17", localChanges: "Catalogue copy, semantic tokens.", files: ["src/components/example.tsx"] };
const header = (name: string) => `/** Derived from Shadcn UI Kit item ${name} (free), registry retrieved 2026-11-17, approved 2026-11-17 (PR 0). Local changes: docs/ui-sources.md. */\n`;

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out); else if (/\.(?:tsx?|mjs|cjs|jsx?)$/.test(name)) out.push(path);
  }
  return out;
}

describe("kit provenance record", () => {
  it("validates the schema", () => {
    expect(validateKitRecord(sample)).toEqual([]);
    expect(validateKitRecord({ ...sample, tier: "other" as never, installed: "yesterday", files: [], approvedBy: " " }).length).toBe(4);
    expect(validateKitRecord({ ...sample, files: ["../outside.ts"] })).toHaveLength(1);
    expect(new Set(kitProvenance.map((record) => record.item)).size).toBe(kitProvenance.length);
    for (const record of kitProvenance) expect(validateKitRecord(record), record.item).toEqual([]);
  });
  it("reads the header only when it opens the file", () => {
    expect(kitHeaderItem(header("stat-card1") + "export {};")).toBe("stat-card1");
    expect(kitHeaderItem("export {};\n" + header("stat-card1"))).toBeNull();
    expect(kitHeaderItem("// plain file")).toBeNull();
  });
  it("lists only files that exist and carry the header for their item", () => {
    for (const record of kitProvenance) for (const file of record.files) {
      expect(existsSync(join(root, file)), file).toBe(true);
      expect(kitHeaderItem(readFileSync(join(root, file), "utf8")), file).toBe(record.item);
    }
  });
  it("finds no kit-derived file that is missing from the record", () => {
    const listed = new Set(kitProvenance.flatMap((record) => record.files));
    const unlisted = ["src", "scripts", "tests"].flatMap((dir) => walk(join(root, dir))).map((file) => file.slice(root.length + 1))
      .filter((file) => kitHeaderItem(readFileSync(join(root, file), "utf8")) !== null && !listed.has(file));
    expect(unlisted).toEqual([]);
  });
});

describe("token leak guard", () => {
  // Synthetic values assembled at runtime; never a real credential.
  const name = ["REGISTRY", "TOKEN"].join("_");
  const kit = ["shadcn", "uikit"].join("");
  const letters = ["abcdefghij", "klmnopqrst", "uvwxyz"].join("");
  const fake = ["fake", "token", "0123456789", "abcdef"].join("");
  it("accepts the documented placeholders", () => {
    expect(scanForSecrets('"Authorization": "Bearer ${REGISTRY_TOKEN}"')).toEqual([]);
    for (const text of [`${name}=`, `${name}=proxy-injected npx shadcn add @shadcnuikit/x`, `${name}: proxy-injected`, `${name}="\${${name}}"`, `export ${name}=`, `bearer proxy-injected`]) expect(scanForSecrets(text), text).toEqual([]);
    expect(scanForSecrets("send a Bearer token in the header")).toEqual([]);
  });
  it("rejects a token-like value after Bearer in any case, with or without digits", () => {
    for (const word of ["Bearer", "bearer", "BEARER"]) {
      expect(scanForSecrets(`Authorization: ${word} ${fake}`), word).toEqual(["bearer-token"]);
      expect(scanForSecrets(`Authorization: ${word} ${letters}`), word).toEqual(["bearer-token"]);
    }
    expect(scanForSecrets(`"Authorization": "Bearer ${fake}"`)).toEqual(["bearer-token"]);
  });
  it("rejects a non-empty REGISTRY_TOKEN assignment in every form", () => {
    for (const text of [`${name}=${fake}`, `${name} = ${fake}`, `${name}="${fake}"`, `${name}='${fake}'`, `${name}: ${fake}`, `export ${name}=${fake}`, `"${name}": "${fake}"`]) expect(scanForSecrets(text), "assignment form").toEqual(["registry-token-assignment"]);
  });
  it("rejects a kit registry index or item", () => {
    const schema = ["https://ui.shadcn.com/schema/", "registry.json"].join("");
    expect(scanForSecrets(JSON.stringify({ $schema: schema, name: kit, items: [] }, null, 2))).toEqual(["kit-registry-index"]);
    expect(scanForSecrets(JSON.stringify({ $schema: schema, name: "other" }))).toEqual([]);
    const item = JSON.stringify({ name: "x", type: ["registry", "block"].join(":"), files: [{ path: "a.tsx", content: "body" }] });
    expect(scanForSecrets(item)).toEqual(["kit-registry-item"]);
    expect(scanForSecrets(JSON.stringify({ type: "registry:block", files: [{ path: "a.tsx" }] }))).toEqual([]);
  });
  it("finds nothing in any tracked text file", () => {
    const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const leaks: string[] = [];
    for (const file of tracked) {
      const path = join(root, file);
      if (!existsSync(path) || statSync(path).size > 2_000_000 || !statSync(path).isFile()) continue;
      const buffer = readFileSync(path);
      if (buffer.includes(0)) continue;
      for (const rule of scanForSecrets(buffer.toString("utf8"))) leaks.push(`${file}: ${rule}`);
    }
    expect(leaks).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, "components.json"), "utf8")).registries["@shadcnuikit"].headers.Authorization).toBe("Bearer ${REGISTRY_TOKEN}");
  }, 30_000); // scans every tracked file; slow under load
});

describe("chat-app provenance", () => {
  it("lists as copied only files that exist and carry the Derived from header naming their source", () => {
    for (const entry of chatAppProvenance.files) {
      expect(existsSync(join(root, entry.file)), entry.file).toBe(true);
      expect(chatAppHeaderSource(readFileSync(join(root, entry.file), "utf8")), entry.file).toContain(entry.source.split(", ")[0]);
      expect(modelledHeaderSource(readFileSync(join(root, entry.file), "utf8")), entry.file).toBeNull();
    }
  });
  it("lists modelled-on references only with the modelled-on header and never the Derived from header", () => {
    for (const entry of kitChatAppReferences.files) {
      const source = readFileSync(join(root, entry.file), "utf8");
      expect(existsSync(join(root, entry.file)), entry.file).toBe(true);
      expect(modelledHeaderSource(source), entry.file).toContain(entry.source.split(", ")[0]);
      expect(chatAppHeaderSource(source), entry.file).toBeNull();
      expect(kitHeaderItem(source), entry.file).toBeNull();
    }
  });
  it("finds no file with either header that is missing from its list", () => {
    const copied = new Set<string>(chatAppProvenance.files.map(entry => entry.file));
    const modelled = new Set<string>(kitChatAppReferences.files.map(entry => entry.file));
    const files = ["src", "scripts", "tests"].flatMap(dir => walk(join(root, dir))).map(file => file.slice(root.length + 1));
    const read = (file: string) => readFileSync(join(root, file), "utf8");
    expect(files.filter(file => chatAppHeaderSource(read(file)) !== null && !copied.has(file))).toEqual([]);
    expect(files.filter(file => modelledHeaderSource(read(file)) !== null && !modelled.has(file))).toEqual([]);
  });
});

describe("admin-dashboard provenance (Events C14 calendar, Communities C09b profile)", () => {
  it("records the founder approval", () => {
    expect(adminDashboardProvenance).toMatchObject({ commit: "1631106", approvedBy: "founder", approvedOn: "2026-11-19" });
  });
  it("lists as copied only files with the Derived from header and a measured share", () => {
    for (const entry of adminDashboardProvenance.files) {
      const source = readFileSync(join(root, entry.file), "utf8");
      expect(adminDashboardHeader(source), entry.file).toEqual({ form: "derived", source: entry.source });
      expect(entry.identical, entry.file).toBeGreaterThan(0);
      expect(entry.identical, entry.file).toBeLessThanOrEqual(100);
    }
  });
  it("lists modelled-on files only with the modelled-on header and no copied claim", () => {
    for (const entry of adminDashboardReferences.files) {
      const source = readFileSync(join(root, entry.file), "utf8");
      expect(existsSync(join(root, entry.file)), entry.file).toBe(true);
      expect(adminDashboardHeader(source)?.form, entry.file).toBe("modelled");
      expect(adminDashboardHeaderSource(source), entry.file).toBe(entry.source);
      expect(chatAppHeaderSource(source), entry.file).toBeNull();
      expect(kitHeaderItem(source), entry.file).toBeNull();
    }
  });
  it("finds no file with either header that is missing from its list", () => {
    const copied = new Set<string>(adminDashboardProvenance.files.map(entry => entry.file));
    const modelled = new Set<string>(adminDashboardReferences.files.map(entry => entry.file));
    const files = ["src", "scripts", "tests"].flatMap(dir => walk(join(root, dir))).map(file => file.slice(root.length + 1));
    const read = (file: string) => readFileSync(join(root, file), "utf8");
    expect(files.filter(file => adminDashboardHeader(read(file))?.form === "derived" && !copied.has(file))).toEqual([]);
    expect(files.filter(file => adminDashboardHeader(read(file))?.form === "modelled" && !modelled.has(file))).toEqual([]);
  });
});
