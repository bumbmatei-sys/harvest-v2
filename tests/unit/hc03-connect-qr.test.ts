import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { contrastRatio } from "../../src/lib/theme";
import { BRAND_THEMES } from "../../src/lib/theme-registry";
import { createLinkInput, effectiveStatus, formatShortCode, linkActionInput, normalizeShortCode, publicLinkUrls } from "../../src/lib/connect-links";
import { QR_MIN_CONTRAST, qrColors, qrMatrix, qrPath, qrPdf, qrPng, qrSvg, type QrMatrix } from "../../src/server/connect-qr";

const publicCode = "0123456789abcdef0123456789abcdef", shortCode = "7K4MQ9PX2HTB";
const urls = publicLinkUrls("https://harvest.example.test", { publicCode, shortCode });

/** Decode the exact RGB PNG the exporter writes (8-bit, filter 0, no interlace) into RGBA pixels. */
function decodePng(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8, width = 0, height = 0;
  const data: Buffer[] = [], chunks: string[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8), body = png.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (type === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); expect([...body.subarray(8)]).toEqual([8, 2, 0, 0, 0]); }
    if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  // No text, time or other metadata chunks.
  expect(chunks).toEqual(["IHDR", "IDAT", "IEND"]);
  const raw = inflateSync(Buffer.concat(data)), rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 3 + 1)]).toBe(0);
    for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) rgba[(y * width + x) * 4 + c] = raw[y * (width * 3 + 1) + 1 + x * 3 + c];
    for (let x = 0; x < width; x++) rgba[(y * width + x) * 4 + 3] = 255;
  }
  return { width, height, rgba };
}
/** Rasterize a module grid (dark cells) with a quiet zone, the way a phone camera would see it. */
function rasterize(size: number, dark: (row: number, column: number) => boolean, scale = 8, quiet = 4) {
  const width = (size + quiet * 2) * scale, rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - quiet, column = Math.floor(x / scale) - quiet;
    if (row >= 0 && column >= 0 && row < size && column < size && dark(row, column)) rgba.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  return { width, rgba };
}
/** Parse the exporter's SVG path ("Mx yhNv1h-Nz" runs) back into dark cells. */
function cellsFromPath(path: string, offset: number) {
  const cells = new Set<string>();
  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i++) cells.add(`${Number(y) - offset}:${Number(x) - offset + i}`);
  }
  return cells;
}

describe("short codes and public URLs", () => {
  it("normalizes typed short codes and rejects anything else", () => {
    expect(normalizeShortCode("7k4m-q9px-2htb")).toBe(shortCode);
    expect(normalizeShortCode(" 7K4M Q9PX 2HTB ")).toBe(shortCode);
    expect(normalizeShortCode("oooo-iiii-llll")).toBe("000011111111");
    for (const bad of ["", "7K4MQ9PX2HT", "7K4MQ9PX2HTBX", "7K4MQ9PX2HTU", "7K4M/Q9PX/2HTB", "%37K4MQ9PX2HTB", "x".repeat(41), publicCode]) {
      expect(normalizeShortCode(bad), bad).toBeUndefined();
    }
    expect(formatShortCode(shortCode)).toBe("7K4M-Q9PX-2HTB");
  });

  it("puts only the opaque code in each URL", () => {
    expect(urls).toEqual({ qr: `https://harvest.example.test/c/${publicCode}`, short: "https://harvest.example.test/s/7K4M-Q9PX-2HTB", shortDisplay: "harvest.example.test/s/7K4M-Q9PX-2HTB" });
    expect(new URL(urls.qr).search).toBe("");
    expect(new URL(urls.short).search).toBe("");
  });

  it("validates organizer input and actions strictly", () => {
    expect(createLinkInput.parse({ label: "  Night 2  ", publicTitle: "" })).toEqual({ label: "Night 2", publicTitle: null, locale: "en", formVersionId: null });
    expect(() => createLinkInput.parse({ tenantId: "x" })).toThrow();
    expect(() => createLinkInput.parse({ locale: "xx" })).toThrow();
    expect(() => linkActionInput.parse({ action: "unarchive" })).toThrow();
    expect(() => linkActionInput.parse({ action: "rotate", expectedCode: "ABC" })).toThrow();
    expect(linkActionInput.parse({ action: "publish", expiresAt: "2030-01-01T10:00:00+02:00" }).expiresAt).toBe("2030-01-01T10:00:00+02:00");
  });

  it("shows published links past their expiry as expired", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(effectiveStatus("published", "2026-11-07T11:59:59Z", now)).toBe("expired");
    expect(effectiveStatus("published", "2026-11-07T12:00:01Z", now)).toBe("published");
    expect(effectiveStatus("disabled", "2020-01-01T00:00:00Z", now)).toBe("disabled");
    expect(effectiveStatus("published", null, now)).toBe("published");
  });
});

describe("QR rendering and exports", () => {
  const matrix: QrMatrix = qrMatrix(urls.qr);

  it("keeps module contrast high for every palette and brand theme", () => {
    for (const theme of BRAND_THEMES) for (const palette of ["standard", "brand"] as const) {
      const colors = qrColors(palette, theme);
      expect(contrastRatio(colors.ink, colors.background), `${theme}/${palette}`).toBeGreaterThanOrEqual(QR_MIN_CONTRAST);
    }
    expect(qrColors("brand").frame).not.toBeNull();
    expect(qrColors("standard").frame).toBeNull();
  });

  it("encodes exactly the public URL (decoded independently)", () => {
    const { width, rgba } = rasterize(matrix.size, matrix.dark);
    expect(jsQR(rgba, width, width)?.data).toBe(urls.qr);
  });

  it("exports a PNG that decodes to the URL, in both palettes, with no metadata", () => {
    for (const palette of ["standard", "brand"] as const) {
      const { width, height, rgba } = decodePng(qrPng(matrix, qrColors(palette)));
      expect(width).toBe(height);
      expect(width).toBeGreaterThanOrEqual(800);
      expect(jsQR(rgba, width, height)?.data, palette).toBe(urls.qr);
    }
  });

  it("exports an SVG whose path is the same code, with an escaped title and nothing executable", () => {
    for (const palette of ["standard", "brand"] as const) {
      const colors = qrColors(palette), svg = qrSvg(matrix, colors, `QR <code> & "${urls.shortDisplay}"`);
      expect(svg).not.toMatch(/<script|on\w+=|href=|<image|<foreignObject/i);
      expect(svg).toContain("<title>QR &#60;code&#62; &#38; &#34;harvest.example.test/s/7K4M-Q9PX-2HTB&#34;</title>");
      const offset = 4 + (colors.frame ? 2 : 0), path = svg.match(/<path fill="[^"]+" d="([^"]+)"/)?.[1] ?? "";
      expect(path).toBe(qrPath(matrix, offset));
      const cells = cellsFromPath(path, offset);
      const { width, rgba } = rasterize(matrix.size, (row, column) => cells.has(`${row}:${column}`));
      expect(jsQR(rgba, width, width)?.data, palette).toBe(urls.qr);
    }
  });

  it("exports a one-page A4 PDF whose rectangles decode to the URL and whose text is the short URL", () => {
    for (const palette of ["standard", "brand"] as const) {
      const colors = qrColors(palette), pdf = qrPdf(matrix, colors, "Scan with your phone camera, or type this address:", urls.shortDisplay).toString("latin1");
      expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
      expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
      expect(pdf).toContain("/MediaBox [0 0 595 842]");
      expect(pdf).toContain(`(${urls.shortDisplay}) Tj`);
      expect(pdf).not.toMatch(/\/JavaScript|\/OpenAction|\/URI|\/Launch|\/EmbeddedFile|\/Producer|\/Creator/);
      // Every xref offset points at its object.
      const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
      const offsets = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((match) => Number(match[1]));
      offsets.forEach((offset, index) => expect(pdf.slice(offset, offset + `${index + 1} 0 obj\n`.length)).toBe(`${index + 1} 0 obj\n`));
      // Rebuild the grid from the module rectangles (the ones drawn after the ink colour is set).
      const stream = pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("\nendstream"));
      const inkOperator = `${[1, 3, 5].map((at) => (parseInt(colors.ink.slice(at, at + 2), 16) / 255).toFixed(4)).join(" ")} rg`;
      const ink = stream.split("\n").indexOf(inkOperator);
      expect(ink).toBeGreaterThan(0);
      const rects = stream.split("\n").slice(ink + 1).filter((line) => line.endsWith(" re f")).map((line) => line.split(" ").slice(0, 3).map(Number));
      const unit = rects[0][2], xs = rects.map(([x]) => x), ys = rects.map(([, y]) => y);
      const minX = Math.min(...xs), maxY = Math.max(...ys);
      const cells = new Set(rects.map(([x, y]) => `${Math.round((maxY - y) / unit)}:${Math.round((x - minX) / unit)}`));
      // The first dark row/column of a QR code is the finder pattern at (0, 0).
      const { width, rgba } = rasterize(matrix.size, (row, column) => cells.has(`${row}:${column}`));
      expect(jsQR(rgba, width, width)?.data, palette).toBe(urls.qr);
    }
  });

  it("replaces non-ASCII PDF text instead of emitting unencodable bytes", () => {
    const pdf = qrPdf(matrix, qrColors("standard"), "Scanează (cod) \\ test", "example.test/s/AAAA-BBBB-CCCC").toString("latin1");
    expect(pdf).toContain("(Scaneaz? \\(cod\\) \\\\ test) Tj");
  });
});
