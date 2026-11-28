import "server-only";
import { effectiveStatus } from "@/lib/connect-links";
import type { BrandTheme } from "@/lib/theme-registry";
import { connectLinks } from "@/lib/site-address";
import { qrColors, qrMatrix, qrPath } from "@/server/connect-qr";
import type { ConnectLink } from "@/server/connect-links";

/** Server-side view data for one link: public URLs, effective status and the QR drawing. */
export function linkView(link: ConnectLink, palette: "standard" | "brand" = "standard", theme: BrandTheme = "harvest") {
  const urls = connectLinks(link), matrix = qrMatrix(urls.qr), colors = qrColors(palette, theme);
  const margin = 4 + (colors.frame ? 2 : 0);
  return { urls, status: effectiveStatus(link.status, link.expiresAt), qr: { path: qrPath(matrix, margin), modules: matrix.size, margin, colors } };
}
