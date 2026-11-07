import "server-only";
import type { Database } from "../db/client";
import { exportQuery, formatShortCode, publicLinkUrls } from "../lib/connect-links";
import { downloadDisposition } from "../lib/download-filename";
import { requiredEnv } from "../lib/env";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { getConnectLink } from "./connect-links";
import { qrColors, qrMatrix, qrPdf, qrPng, qrSvg } from "./connect-qr";

/** The application origin printed into QR codes and short URLs. */
export function publicOrigin() { return new URL(requiredEnv("BETTER_AUTH_URL")).origin; }

export async function exportConnectLink(db: Database, userId: string, workspace: string, campaign: string, link: string, query: unknown) {
  const { format, palette } = exportQuery.parse(query);
  const { link: row, brandTheme } = await getConnectLink(db, userId, workspace, campaign, link);
  // Archived codes are retired: exporting them would only produce dead printed material.
  if (row.status === "archived") throw new AccessError(409, message("Connect.outcomeArchived"), { reason: "link_archived" });
  const urls = publicLinkUrls(publicOrigin(), row);
  const matrix = qrMatrix(urls.qr), colors = qrColors(palette, brandTheme);
  const name = `harvest-qr-${formatShortCode(row.shortCode)}`;
  if (format === "png") return { body: qrPng(matrix, colors), contentType: "image/png", disposition: downloadDisposition(`${name}.png`) };
  if (format === "svg") return { body: Buffer.from(qrSvg(matrix, colors, message("Connect.qrImageTitle", { url: urls.shortDisplay })), "utf8"), contentType: "image/svg+xml; charset=utf-8", disposition: downloadDisposition(`${name}.svg`) };
  return { body: qrPdf(matrix, colors, message("Connect.qrPdfCaption"), urls.shortDisplay), contentType: "application/pdf", disposition: downloadDisposition(`${name}.pdf`) };
}
