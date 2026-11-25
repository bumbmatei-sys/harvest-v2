import { describe, expect, it } from "vitest";
import { formatFromHeader } from "../../src/lib/email-address";

const address = "hello@mail.example.test";
/** A small reader for what the writer produces: a quoted string or encoded words, then the address. */
function read(header: string): { name: string; address: string } {
  const m = /^(.*) <([^<>]+)>$/.exec(header);
  if (!m) return { name: "", address: header };
  const raw = m[1];
  if (raw.startsWith("=?")) return { name: raw.split(" ").map((w) => { const p = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(w); if (!p) throw new Error("bad word"); return Buffer.from(p[1], "base64").toString("utf8"); }).join(""), address: m[2] };
  if (raw.startsWith('"')) return { name: raw.slice(1, -1).replace(/\\(.)/g, "$1"), address: m[2] };
  return { name: raw, address: m[2] };
}

describe("From header with a display name", () => {
  it("gives the bare address without a name", () => {
    expect(formatFromHeader(null, address)).toBe(address);
    expect(formatFromHeader("", address)).toBe(address);
    expect(formatFromHeader("  \t ", address)).toBe(address);
  });
  it("keeps a plain name plain", () => {
    expect(formatFromHeader("Grace Community Church", address)).toBe(`Grace Community Church <${address}>`);
    expect(formatFromHeader("  Pastor   Sam  ", address)).toBe(`Pastor Sam <${address}>`);
  });
  it("quotes names with specials: comma, semicolon, dot, parentheses, colon, at sign, brackets", () => {
    for (const name of ["Smith, John", "Grace; Hope", "St. Mark's", "Grace (Main)", "Info: Grace", "a@b", "[Grace]"]) {
      const header = formatFromHeader(name, address);
      expect(header).toBe(`"${name}" <${address}>`);
      expect(read(header)).toEqual({ name, address });
    }
  });
  it("escapes a quote and a backslash inside a quoted name", () => {
    const header = formatFromHeader('The "Rock" Church \\ Co.', address);
    expect(header).toBe(`"The \\"Rock\\" Church \\\\ Co." <${address}>`);
    expect(read(header).name).toBe('The "Rock" Church \\ Co.');
  });
  it("encodes non-ASCII names as RFC 2047 words that read back exactly", () => {
    for (const name of ["Église Saint-Étienne", "恩典教会", "Grace 🙏 Church", "José, Pastor"]) {
      const header = formatFromHeader(name, address);
      expect(header).toMatch(/^(=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= ?)+ <hello@mail\.example\.test>$/);
      expect(header).not.toMatch(/[^\u0000-\u007f]/);
      expect(read(header)).toEqual({ name, address });
    }
  });
  it("keeps every encoded word within 75 characters and never splits a character", () => {
    const name = "恩典教会".repeat(20) + "é" + "🙏".repeat(15);
    const header = formatFromHeader(name, address);
    const words = header.slice(0, header.lastIndexOf(" <")).split(" ");
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    expect(read(header).name).toBe(name);
  });
  it("quotes an ASCII name that looks like an encoded word, so no client decodes it", () => {
    for (const name of ["=?UTF-8?B?QWRtaW4=?=", "a=b", "why?"]) {
      const header = formatFromHeader(name, address);
      expect(header).toBe(`"${name}" <${address}>`);
      expect(read(header).name).toBe(name);
    }
  });
  it("cannot be made to add a header line: control characters and line breaks are dropped", () => {
    const header = formatFromHeader("Grace\r\nBcc: evil@example.test", address);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toBe(`"Grace Bcc: evil@example.test" <${address}>`);
    expect(formatFromHeader("Grace\u0000\u001b[31m", address)).not.toMatch(/[\u0000-\u001f]/);
  });
});
