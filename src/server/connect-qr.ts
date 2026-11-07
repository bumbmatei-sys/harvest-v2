import { crc32, deflateSync } from "node:zlib";
import QRCode from "qrcode";
import { contrastRatio } from "../lib/theme";
import { qrExportColors, themeRegistry, type BrandTheme } from "../lib/theme-registry";
import type { QrPalette } from "../lib/connect-links";

// HC-03: printable/projectable QR rendering. The encoded text is the public link URL only: no
// tenant, campaign, person or secret. Error correction Q tolerates ~25% damage (print, glare).
export type QrMatrix = { size: number; dark: (row: number, column: number) => boolean };
export type QrColors = { ink: string; background: string; frame: string | null };
/** Minimum module/background contrast. Scanners need far more than text does. */
export const QR_MIN_CONTRAST = 7;
const QUIET = 4;
const FRAME = 2;

export function qrMatrix(text: string): QrMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "Q" });
  return { size: modules.size, dark: (row, column) => modules.get(row, column) === 1 };
}

/** The workspace's brand ink and frame; falls back to standard ink if contrast is not high enough. */
export function qrColors(palette: QrPalette, theme: BrandTheme = "harvest"): QrColors {
  const background = qrExportColors.background;
  if (palette === "brand") {
    const tokens = themeRegistry[theme].light;
    const ink = tokens["--earth"];
    if (contrastRatio(ink, background) >= QR_MIN_CONTRAST) return { ink, background, frame: tokens["--brand-color"] };
  }
  return { ink: qrExportColors.standardInk, background, frame: null };
}

/** One SVG path for every dark module, merged into horizontal runs; origin is the first module. */
export function qrPath(matrix: QrMatrix, offset = 0) {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size;) {
      if (!matrix.dark(row, column)) { column++; continue; }
      let run = 1;
      while (column + run < matrix.size && matrix.dark(row, column + run)) run++;
      parts.push(`M${column + offset} ${row + offset}h${run}v1h-${run}z`);
      column += run;
    }
  }
  return parts.join("");
}

function margin(colors: QrColors) { return QUIET + (colors.frame ? FRAME : 0); }

export function qrSvg(matrix: QrMatrix, colors: QrColors, title: string, pixels = 1024) {
  const edge = margin(colors), total = matrix.size + edge * 2;
  const escape = (value: string) => value.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
  const frame = colors.frame ? `<rect width="${total}" height="${total}" fill="${colors.frame}"/><rect x="${FRAME}" y="${FRAME}" width="${total - FRAME * 2}" height="${total - FRAME * 2}" fill="${colors.background}"/>`
    : `<rect width="${total}" height="${total}" fill="${colors.background}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${pixels}" height="${pixels}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><title>${escape(title)}</title>${frame}<path fill="${colors.ink}" d="${qrPath(matrix, edge)}"/></svg>\n`;
}

function rgb(hex: string) { return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)); }
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
/** 8-bit RGB PNG, `scale` pixels per module, no metadata chunks. */
export function qrPng(matrix: QrMatrix, colors: QrColors, scale = 24) {
  const edge = margin(colors), modules = matrix.size + edge * 2, width = modules * scale;
  const [ink, background, frame] = [rgb(colors.ink), rgb(colors.background), colors.frame ? rgb(colors.frame) : null];
  const raw = Buffer.alloc((width * 3 + 1) * width);
  for (let y = 0; y < width; y++) {
    const rowStart = y * (width * 3 + 1), moduleRow = Math.floor(y / scale);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const moduleColumn = Math.floor(x / scale);
      const inFrame = frame && (moduleRow < FRAME || moduleColumn < FRAME || moduleRow >= modules - FRAME || moduleColumn >= modules - FRAME);
      const r = moduleRow - edge, c = moduleColumn - edge;
      const color = inFrame ? frame : r >= 0 && c >= 0 && r < matrix.size && c < matrix.size && matrix.dark(r, c) ? ink : background;
      raw.set(color, rowStart + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** PDF strings: printable ASCII only (Type 1 standard fonts), with PDF escapes. */
function pdfText(value: string) {
  return value.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}
function pdfColor(hex: string) { return rgb(hex).map((value) => (value / 255).toFixed(4)).join(" "); }
/**
 * Single A4 page: the code at 400pt (about 14cm) and, beneath it, the caption and the short URL so
 * people who cannot scan can type it. Vector rectangles only; no images, fonts or metadata embedded.
 */
export function qrPdf(matrix: QrMatrix, colors: QrColors, caption: string, shortUrl: string) {
  const pageWidth = 595, pageHeight = 842, side = 400, edge = margin(colors), total = matrix.size + edge * 2;
  const unit = side / total, left = (pageWidth - side) / 2, top = pageHeight - 96;
  const ops: string[] = [];
  const rect = (x: number, y: number, w: number, h: number) => `${(left + x * unit).toFixed(3)} ${(top - (y + h) * unit).toFixed(3)} ${(w * unit).toFixed(3)} ${(h * unit).toFixed(3)} re f`;
  if (colors.frame) { ops.push(`${pdfColor(colors.frame)} rg`, rect(0, 0, total, total), `${pdfColor(colors.background)} rg`, rect(FRAME, FRAME, total - FRAME * 2, total - FRAME * 2)); }
  else ops.push(`${pdfColor(colors.background)} rg`, rect(0, 0, total, total));
  ops.push(`${pdfColor(colors.ink)} rg`);
  for (let row = 0; row < matrix.size; row++) for (let column = 0; column < matrix.size; column++) {
    if (matrix.dark(row, column)) ops.push(rect(column + edge, row + edge, 1, 1));
  }
  const urlSize = Math.min(24, Math.floor(side / (0.6 * Math.max(shortUrl.length, 1))));
  const textTop = top - side - 40;
  ops.push(`${pdfColor(qrExportColors.standardInk)} rg`, `BT /F1 16 Tf ${left} ${textTop} Td (${pdfText(caption)}) Tj ET`,
    `BT /F2 ${urlSize} Tf ${left} ${textTop - urlSize - 14} Td (${pdfText(shortUrl)}) Tj ET`);
  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body, "latin1")); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
