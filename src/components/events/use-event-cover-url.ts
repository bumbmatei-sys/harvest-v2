"use client";
import { useCallback, useEffect, useRef, useState } from "react";

async function signedCoverUrl(endpoint: string, signal?: AbortSignal) {
  try {
    const response = await fetch(`${endpoint}/cover`, { signal });
    const data = response.ok ? await response.json() as { url?: string } : null;
    return typeof data?.url === "string" ? data.url : null;
  } catch { return null; }
}

/**
 * The signed address of an event's cover, from the server's own cover route (valid for about a minute). It is fetched when the cover
 * changes and once more if the picture fails to load; storage addresses are never built in the browser.
 */
export function useEventCoverUrl(endpoint: string, coverFileId: string | null) {
  const [url, setUrl] = useState<string | null>(null), retried = useRef<string | null>(null);
  useEffect(() => {
    if (!coverFileId) return;
    retried.current = null;
    const controller = new AbortController();
    void signedCoverUrl(endpoint, controller.signal).then((next) => { if (!controller.signal.aborted) setUrl(next); });
    return () => controller.abort();
  }, [endpoint, coverFileId]);
  const failed = useCallback(() => {
    if (!coverFileId || retried.current === coverFileId) return;
    retried.current = coverFileId;
    void signedCoverUrl(endpoint).then(setUrl);
  }, [endpoint, coverFileId]);
  return { url: coverFileId ? url : null, failed };
}
