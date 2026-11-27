import type { Database } from "../db/client";
import { message } from "../i18n/messages";
import { qrColors, qrMatrix, qrPng, qrSvg } from "./connect-qr";
import { getPublicBio } from "./link-in-bio";
import { readSiteAddresses, type SiteAddressEnvironment } from "../lib/site-address";

/** The page's public address on the configured site (the shared site-address module), never from a request's Host header. */
export function bioPageUrl(handle: string, env: Record<string, string | undefined> = process.env) {
  try { return new URL(`/l/${encodeURIComponent(handle)}`, readSiteAddresses(env as SiteAddressEnvironment).app).href; } catch { return null; }
}

/**
 * The QR code of a published link in bio page, drawn by the Connect QR renderer. The encoded text is only the page's public address on the configured site
 * address, built from the stored handle; null when the page is not public (unpublished, missing and production answer alike) or no site address is set.
 */
export async function bioPageQr(db: Database, handle: string, format: "svg" | "png", env: Record<string, string | undefined> = process.env) {
  const view = await getPublicBio(db, handle, env);
  const url = view ? bioPageUrl(view.handle, env) : null;
  if (!view || !url) return null;
  const matrix = qrMatrix(url), colors = qrColors("standard");
  return format === "png"
    ? { type: "image/png", body: new Uint8Array(qrPng(matrix, colors)) }
    : { type: "image/svg+xml", body: qrSvg(matrix, colors, message("LinkInBio.public.qrTitle", { name: view.name })) };
}
