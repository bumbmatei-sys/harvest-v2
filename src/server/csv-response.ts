import { downloadDisposition } from "../lib/download-filename";

/** A private, non-cached CSV download with a safe display filename. */
export function csvResponse(fileName: string, body: string) {
  return new Response(body, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": downloadDisposition(fileName),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
