import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { qrColors, qrMatrix, qrPng, qrSvg } from "./connect-qr";
import { getPublicBio } from "./link-in-bio";

/**
 * The QR code of a published link in bio page, drawn by the Connect QR renderer. The encoded text is only the page's public address; null when the page is
 * not public (unpublished, missing and production answer alike).
 */
export async function bioPageQr(db: Database, handle: string, format: "svg" | "png", origin: string) {
  const view = await getPublicBio(db, handle);
  if (!view) return null;
  const matrix = qrMatrix(`${origin}/l/${handle}`), colors = qrColors("standard");
  return format === "png"
    ? { type: "image/png", body: new Uint8Array(qrPng(matrix, colors)) }
    : { type: "image/svg+xml", body: qrSvg(matrix, colors, message("LinkInBio.public.qrTitle", { name: view.name })) };
}
