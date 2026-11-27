import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "../../scripts/source-guards";

// HC-DEC5 restricted decryption: only the audited wrapper may import the raw opener, and only the
// intake and invitation paths (plus rotation) may import the crypto module at all.
const RAW_OPEN_ALLOWED = ["src/server/connect-decrypt.ts"];
const CRYPTO_ALLOWED = [
  "src/server/connect-decrypt.ts", "src/server/connect-intake.ts", "src/server/connect-invitations.ts", "src/server/connect-key-rotation.ts",
];
// Social credentials, inbox cursors and posting grants use separate key purposes. Only the listed crypto modules may resolve keys.
const SOCIAL_CRYPTO = ["src/server/social/credential-envelope.ts", "src/server/social/inbox-tokens.ts"];
const SOCIAL_KEY_USERS = [...SOCIAL_CRYPTO, "src/server/social/webhook-secrets.ts", "src/server/social/posting-media.ts"];
const importsOf = (source: string) => [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)].map((m) => ({ names: m[1], from: m[2] }));
const scan = () => sourceFiles("src").filter((f) => /\.tsx?$/.test(f)).map((file) => ({ file, source: readFileSync(file, "utf8") }));

describe("connect crypto source guard", () => {
  it("only the audited wrapper imports openIntake", () => {
    const offenders = scan().filter(({ file, source }) => !RAW_OPEN_ALLOWED.includes(file)
      && (importsOf(source).some((i) => /connect-intake-crypto/.test(i.from) && /\bopenIntake\b/.test(i.names)) || /createDecipheriv/.test(source) && file !== "src/server/connect-intake-crypto.ts" && !SOCIAL_CRYPTO.includes(file)));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
  it("only intake, invitation and rotation modules import the crypto module", () => {
    const offenders = scan().filter(({ file, source }) => !CRYPTO_ALLOWED.includes(file) && file !== "src/server/connect-intake-crypto.ts" && /connect-intake-crypto/.test(source));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
  it("the key provider module is imported only by crypto-side modules", () => {
    const allowed = ["src/server/connect-intake-crypto.ts", "src/server/connect-key-rotation.ts", ...SOCIAL_KEY_USERS];
    const offenders = scan().filter(({ file, source }) => !allowed.includes(file) && file !== "src/server/connect-key-provider.ts" && /connect-key-provider/.test(source));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
  it("restricts opening a staging envelope to the audited wrapper", () => {
    const callers = scan().filter(({ file, source }) => file !== "src/server/contact-envelope.ts" &&
      importsOf(source).some(({ names, from }) => /contact-envelope$/.test(from) && /\bopenContactEnvelope\b/.test(names)));
    expect(callers.map(({ file }) => file)).toEqual(["src/server/connect-decrypt.ts"]);
  });
  it("the guard detects a violation", () => {
    expect(importsOf('import { openIntake } from "./connect-intake-crypto";').some((i) => /\bopenIntake\b/.test(i.names))).toBe(true);
  });
});
