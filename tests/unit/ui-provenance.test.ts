import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kitHeaderItem, kitProvenance, validateKitRecord, type KitItemRecord } from "../../src/lib/ui-provenance";
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
  const fake = ["fake", "token", "0123456789", "abcdef"].join("");
  it("accepts the documented placeholders", () => {
    expect(scanForSecrets('"Authorization": "Bearer ${REGISTRY_TOKEN}"')).toEqual([]);
    expect(scanForSecrets([name + "=", name + "=proxy-injected npx shadcn add @shadcnuikit/x"].join("\n"))).toEqual([]);
    expect(scanForSecrets("send a Bearer token in the header")).toEqual([]);
  });
  it("rejects a token-like value after Bearer", () => {
    expect(scanForSecrets(`Authorization: Bearer ${fake}`)).toEqual(["bearer-token"]);
    expect(scanForSecrets(`"Authorization": "Bearer ${fake}"`)).toEqual(["bearer-token"]);
  });
  it("rejects a non-empty REGISTRY_TOKEN assignment", () => {
    expect(scanForSecrets(`${name}=${fake}`)).toEqual(["registry-token-assignment"]);
    expect(scanForSecrets(`${name} = ${fake}`)).toEqual(["registry-token-assignment"]);
  });
  it("rejects a kit registry index", () => {
    const index = `{ "$schema": "https://ui.shadcn.com/schema/registry.json", "name": "shadcnuikit", "items": [] }`;
    expect(scanForSecrets(index)).toEqual(["kit-registry-index"]);
    expect(scanForSecrets(`{ "$schema": "https://ui.shadcn.com/schema/registry.json", "name": "other" }`)).toEqual([]);
  });
  it("finds nothing in any tracked text file", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
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
  });
});
