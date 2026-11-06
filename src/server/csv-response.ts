/** A private, non-cached CSV download. The file name is reduced to ASCII-safe characters for the header. */
export function csvResponse(fileName: string, body: string) {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(body, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safe}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
