"use client";
import { useEffect, useState } from "react";
import { request } from "@/hooks/use-request";

/** A short signed address of one of the ministry's ready Files, for the owner's own screens (the editor and its previews). Null while loading or unavailable. */
export function useFileUrl(tenantId: string, fileId: string | null | undefined) {
  const [state, setState] = useState<{ id: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let live = true;
    void request<{ url: string }>(`/api/workspaces/${tenantId}/files/${fileId}/download`, { method: "GET" })
      .then((r) => { if (live) setState({ id: fileId, url: r.ok ? r.data.url : null, failed: !r.ok }); });
    return () => { live = false; };
  }, [tenantId, fileId]);
  return fileId && state?.id === fileId ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}
